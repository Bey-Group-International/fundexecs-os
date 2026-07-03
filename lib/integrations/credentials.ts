// lib/integrations/credentials.ts
// Per-org credential resolution for the dispatch layer — the vault's first
// consumer. Until now every adapter read its provider token straight from
// process.env, so all orgs on a deploy shared one credential set (one Gmail
// identity, one Calendly account): single-tenant on every external channel.
// This resolves an org's own secrets (lib/org-secrets.ts, AES-256-GCM vault)
// into the DispatchContext, keyed by the exact env-var names the adapters
// already use so the adapter-side read stays a simple
// `ctx.secrets?.X ?? process.env.X` — org credential wins, deploy env is the
// fallback, and with neither the adapter degrades to mock mode exactly as
// before.
import { getOrgSecret } from "@/lib/org-secrets";
import { vaultConfigured } from "@/lib/vault";

/**
 * The secret keys each credentialed channel can resolve. Keys ARE the env-var
 * names — one org_secrets row per (org, key), matching the vault's
 * (organization_id, provider) uniqueness.
 */
export const CHANNEL_SECRET_KEYS: Record<string, readonly string[]> = {
  gmail: [
    "GMAIL_ACCESS_TOKEN",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    // Inbound: verifies Resend email.received webhooks (app/api/webhooks/resend).
    "RESEND_WEBHOOK_SECRET",
  ],
  calendly: [
    "CALENDLY_API_TOKEN",
    // Inbound: verifies Calendly invitee webhooks (app/api/webhooks/calendly).
    "CALENDLY_WEBHOOK_SECRET",
  ],
  docusign: ["DOCUSIGN_ACCESS_TOKEN", "DOCUSIGN_INTEGRATION_KEY"],
};

/** Every key any channel can resolve — the allow-list for the settings writer. */
export const ALL_SECRET_KEYS: readonly string[] = Object.values(CHANNEL_SECRET_KEYS).flat();

// The Supabase client has no default request timeout, so a hung vault read
// would hold the whole dispatch open. Cap each key lookup; a timed-out key
// degrades to the env fallback like any other per-key failure.
const VAULT_READ_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} vault read timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Resolve the org's stored credentials for one channel. Fast no-op (empty bag)
 * when the channel has no credentialed keys or the vault isn't configured. A
 * per-key decryption failure (tampered row, rotated vault key) degrades that
 * key to the env fallback instead of failing the whole dispatch.
 */
export async function resolveChannelCredentials(
  orgId: string,
  channel: string,
): Promise<Partial<Record<string, string>>> {
  const keys = CHANNEL_SECRET_KEYS[channel];
  if (!keys || keys.length === 0) return {};
  if (!vaultConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return {};

  const secrets: Partial<Record<string, string>> = {};
  await Promise.all(
    keys.map(async (key) => {
      try {
        const value = await withTimeout(getOrgSecret(orgId, key), VAULT_READ_TIMEOUT_MS, key);
        if (value) secrets[key] = value;
      } catch (err) {
        console.error(`[integrations/credentials] failed to resolve ${key} for org ${orgId}:`, err);
      }
    }),
  );
  return secrets;
}
