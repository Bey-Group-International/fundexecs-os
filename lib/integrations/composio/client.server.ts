// Server-only Composio REST client.
//
// This is how the *deployed app* reaches Composio at runtime — distinct from the
// Composio MCP tools used at authoring time. It executes a single Composio tool
// (e.g. GMAIL_FETCH_EMAILS, LINKEDIN_GET_MY_INFO, COMPOSIO_SEARCH_SEC_FILINGS)
// through Composio's public v3 execute endpoint, scoped to a Composio entity /
// user whose app connections were authorized out-of-band.
//
// Honesty discipline (same as the rest of the integrations layer): with no
// Composio API key configured, `composioConfigured()` is false and every caller
// degrades to its non-Composio path or reports "unavailable" — never a fake
// success. The key is resolved per-org (a tenant may bring its own Composio
// account via the vault) falling back to a process-level env key.
//
// The fetch layer is injectable so the mappers and the execute path are unit
// tested with sample payloads and zero network access.

import { getOrgSecret } from "@/lib/org-secrets";

const COMPOSIO_BASE_URL = "https://backend.composio.dev";
const DEFAULT_TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;

/** Env var holding the process-level Composio API key. */
export const COMPOSIO_API_KEY_ENV = "COMPOSIO_API_KEY";
/** Env var holding the default Composio entity / user id to execute under. */
export const COMPOSIO_USER_ID_ENV = "COMPOSIO_USER_ID";
/** org_secrets.provider key for a per-org Composio API key (overrides env). */
export const COMPOSIO_SECRET_KEY = "composio";

export interface ComposioConfig {
  apiKey: string;
  /** The Composio entity / user id the connected accounts live under. */
  userId?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export type ComposioExecuteResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** The envelope Composio's execute endpoint returns around a tool payload. */
interface ComposioEnvelope<T> {
  data?: T;
  successful?: boolean;
  error?: unknown;
}

/** True when a process-level Composio API key is configured. */
export function composioConfigured(): boolean {
  return Boolean(process.env[COMPOSIO_API_KEY_ENV]);
}

/**
 * Resolve the Composio API key for an org: a vaulted per-org key wins over the
 * process-level env key, so a tenant can bring its own Composio account. Returns
 * null when neither is present (caller then degrades to a non-Composio path).
 */
export async function resolveComposioApiKey(orgId?: string): Promise<string | null> {
  if (orgId) {
    try {
      const scoped = await getOrgSecret(orgId, COMPOSIO_SECRET_KEY);
      if (scoped) return scoped;
    } catch {
      // A vault miss/decrypt error must not block the env-key fallback.
    }
  }
  return process.env[COMPOSIO_API_KEY_ENV] ?? null;
}

function errText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(error);
    } catch {
      return "Composio error";
    }
  }
  return String(error);
}

/**
 * Execute one Composio tool by slug against a connected account. Never throws:
 * network, HTTP, and tool-reported failures all resolve to `{ ok:false }` so a
 * caller can fall back cleanly. On success the tool payload is returned unwrapped
 * from Composio's `{ data, successful }` envelope.
 */
export async function executeComposioTool<T = unknown>(
  config: ComposioConfig,
  toolSlug: string,
  args: Record<string, unknown>,
  opts: { connectedAccountId?: string; userId?: string } = {},
): Promise<ComposioExecuteResult<T>> {
  const base = config.baseUrl ?? COMPOSIO_BASE_URL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const userId =
    opts.userId ?? config.userId ?? process.env[COMPOSIO_USER_ID_ENV] ?? "default";

  const body: Record<string, unknown> = { user_id: userId, arguments: args };
  if (opts.connectedAccountId) body.connected_account_id = opts.connectedAccountId;

  let signal: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (typeof AbortController === "function") {
    const controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  try {
    const res = await fetchImpl(`${base}/api/v3/tools/execute/${encodeURIComponent(toolSlug)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      return { ok: false, error: `Composio ${toolSlug} returned HTTP ${res.status}.` };
    }

    const json = (await res.json()) as ComposioEnvelope<T>;
    if (json && json.successful === false) {
      return { ok: false, error: errText(json.error) ?? `Composio ${toolSlug} reported failure.` };
    }
    // v3 wraps the tool payload under `data`; tolerate a bare payload as well.
    const data = (json && typeof json === "object" && "data" in json ? json.data : json) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Composio ${toolSlug} request failed.`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Build a ComposioConfig for an org, or null when Composio is unconfigured.
 * Convenience for connectors that only need the default entity + real fetch.
 */
export async function composioConfigForOrg(
  orgId?: string,
  overrides: Partial<ComposioConfig> = {},
): Promise<ComposioConfig | null> {
  const apiKey = overrides.apiKey ?? (await resolveComposioApiKey(orgId));
  if (!apiKey) return null;
  return { apiKey, ...overrides };
}
