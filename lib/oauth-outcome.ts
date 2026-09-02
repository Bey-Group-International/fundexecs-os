// lib/oauth-outcome.ts
// Human-readable copy for the outcome codes the OAuth connect routes redirect
// with.
//
// Every route under app/api/oauth/* already diagnoses its failure precisely and
// hands the reason back on the query string — `/settings?google=exchange_failed`,
// `/meetings?google_calendar=denied`, and so on. Nothing read them: the Settings
// page took no searchParams at all and the Meetings page never looked. So the
// operator bounced through the provider and landed on an unchanged page, with
// no way to tell a refused consent from a missing vault key from a success.
//
// This is the missing half — the routes' vocabulary, translated once, in one
// place, so a code added to a route has an obvious home here.

/** The query parameter each provider's routes report their outcome under. */
export const OAUTH_PROVIDERS = {
  google: "Gmail",
  google_people: "Google Contacts",
  google_calendar: "Google Calendar",
  carta: "Carta",
} as const;

export type OAuthProviderParam = keyof typeof OAUTH_PROVIDERS;

export type OAuthOutcomeTone = "success" | "error";

export interface OAuthOutcome {
  /** Which provider reported it, for the caller that renders more than one. */
  provider: OAuthProviderParam;
  /** Display name of that provider. */
  providerLabel: string;
  /** The raw code, kept so support can be told exactly what came back. */
  code: string;
  tone: OAuthOutcomeTone;
  title: string;
  /** What actually happened and what to do about it. */
  detail: string;
}

type OutcomeCopy = {
  tone: OAuthOutcomeTone;
  title: (provider: string) => string;
  detail: (provider: string) => string;
};

// Keyed by the code the routes emit. Codes shared across providers (most of
// them) are written once; provider-specific ones sit alongside.
const OUTCOMES: Record<string, OutcomeCopy> = {
  connected: {
    tone: "success",
    title: (p) => `${p} connected`,
    detail: () => "The connection is live and ready to use.",
  },
  denied: {
    tone: "error",
    title: (p) => `${p} connection cancelled`,
    detail: () =>
      "Consent was declined at the provider, so nothing was connected. Start the connection again to retry.",
  },
  invalid_callback: {
    tone: "error",
    title: (p) => `${p} connection failed`,
    detail: () =>
      "The provider returned an incomplete response. Start the connection again — if it keeps happening, the redirect URL registered with the provider is likely wrong.",
  },
  invalid_state: {
    tone: "error",
    title: (p) => `${p} connection expired`,
    detail: () =>
      "The connection request was no longer valid — usually because it sat unfinished for more than ten minutes. Start it again and complete it in one go.",
  },
  session_mismatch: {
    tone: "error",
    title: (p) => `${p} connection failed`,
    detail: () =>
      "The connection was started by a different account or session than the one that finished it. Sign in as the account that should own the connection, then try again.",
  },
  forbidden: {
    tone: "error",
    title: (p) => `${p} needs an admin`,
    detail: () =>
      "Only an owner or admin can manage this connection, because it decides which identity the organization acts under. Ask an admin to connect it.",
  },
  not_configured: {
    tone: "error",
    title: (p) => `${p} is not configured`,
    detail: () =>
      "This deployment has no client credentials for the provider, so the connection can't be started. This is a deployment setting, not something to retry.",
  },
  vault_not_configured: {
    tone: "error",
    title: (p) => `${p} can't be connected yet`,
    detail: () =>
      "There is nowhere safe to store the credential — the vault key is missing from this deployment. Refused before consent rather than after, so nothing was exposed.",
  },
  exchange_failed: {
    tone: "error",
    title: (p) => `${p} connection failed`,
    detail: () =>
      "The provider refused to issue a token for this connection. Start it again; if it repeats, the client credentials for this deployment are likely wrong or revoked.",
  },
  no_refresh_token: {
    tone: "error",
    title: (p) => `${p} connection incomplete`,
    detail: () =>
      "The provider returned no refresh token, so the connection could not be kept alive. Remove this app's access in your provider account settings, then connect again to force a fresh consent.",
  },
  store_failed: {
    tone: "error",
    title: (p) => `${p} connection not saved`,
    detail: () =>
      "Consent succeeded but the credential could not be stored, so the connection is not active. Try connecting again.",
  },
  // Google Calendar's callback reports its persistence failure under its own
  // name; same meaning as store_failed.
  save_failed: {
    tone: "error",
    title: (p) => `${p} connection not saved`,
    detail: () =>
      "Consent succeeded but the connection could not be stored, so it is not active. Try connecting again.",
  },
  discovery_failed: {
    tone: "error",
    title: (p) => `${p} is unreachable`,
    detail: () =>
      "The provider's OAuth configuration could not be read, so there was nowhere to send you. This is usually transient — try again shortly.",
  },
  missing_client_credentials: {
    tone: "error",
    title: (p) => `${p} is not configured`,
    detail: () =>
      "No client credentials are stored for this organization, so the connection can't be started. Add them under Organization credentials, then try again.",
  },
  pkce_missing: {
    tone: "error",
    title: (p) => `${p} connection expired`,
    detail: () =>
      "The browser state proving this connection request was yours is gone — usually a cookie cleared, or a different browser finishing what another started. Start the connection again in a single browser.",
  },
};

/**
 * Read whichever provider outcome is present, or null when none is.
 *
 * Accepts the loose shape Next hands a page's `searchParams` (a repeated
 * parameter arrives as an array). Unknown codes still surface — reporting a
 * code we have no copy for beats silently swallowing it, which is the bug this
 * whole module exists to fix.
 */
export function readOAuthOutcome(
  params: Record<string, string | string[] | undefined> | undefined,
): OAuthOutcome | null {
  if (!params) return null;

  for (const provider of Object.keys(OAUTH_PROVIDERS) as OAuthProviderParam[]) {
    const raw = params[provider];
    const code = Array.isArray(raw) ? raw[0] : raw;
    if (!code) continue;

    const providerLabel = OAUTH_PROVIDERS[provider];
    const copy = OUTCOMES[code];
    if (copy) {
      return {
        provider,
        providerLabel,
        code,
        tone: copy.tone,
        title: copy.title(providerLabel),
        detail: copy.detail(providerLabel),
      };
    }
    return {
      provider,
      providerLabel,
      code,
      tone: "error",
      title: `${providerLabel} connection failed`,
      detail: `The connection returned an unrecognized result (${code}). Try again, and quote that code if you contact support.`,
    };
  }

  return null;
}
