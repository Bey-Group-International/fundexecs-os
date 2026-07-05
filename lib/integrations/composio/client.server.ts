// Server-only Composio client, backed by the official @composio/core SDK.
//
// This is how the *deployed app* reaches Composio at runtime. It executes a
// single Composio tool by slug (e.g. GMAIL_FETCH_EMAILS, LINKEDIN_GET_MY_INFO,
// COMPOSIO_SEARCH_WEB, the Marketstack tools) through the SDK's direct tool
// execution — `composio.tools.execute(slug, { userId, arguments })` — NOT the
// agentic tool-router loop. Earn's extraction stays deterministic and
// review-gated; the SDK is just the transport.
//
// Honesty discipline (unchanged): with no Composio API key configured,
// `composioConfigured()` is false and every caller degrades to its non-Composio
// path or reports "unavailable" — never a fake success. The key is resolved
// per-org (a tenant may bring its own Composio account via the vault) falling
// back to a process-level env key. The Composio entity/user id comes from
// COMPOSIO_USER_ID.
//
// The `executor` seam keeps the SDK out of unit tests: tests inject a fake
// executor, so the real @composio/core import only happens at runtime.

import { getOrgSecret } from "@/lib/org-secrets";

const DEFAULT_TIMEOUT_MS = 20_000;

/** Env var holding the process-level Composio API key. */
export const COMPOSIO_API_KEY_ENV = "COMPOSIO_API_KEY";
/** Env var holding the default Composio entity / user id to execute under. */
export const COMPOSIO_USER_ID_ENV = "COMPOSIO_USER_ID";
/** org_secrets.provider key for a per-org Composio API key (overrides env). */
export const COMPOSIO_SECRET_KEY = "composio";

/** The response shape @composio/core's tools.execute resolves to. */
export interface ComposioToolResponse {
  data?: Record<string, unknown>;
  error?: string | null;
  successful?: boolean;
}

/** Body accepted by tools.execute (the subset we send). */
export interface ComposioExecuteBody {
  userId: string;
  arguments: Record<string, unknown>;
  connectedAccountId?: string;
}

/**
 * The pluggable transport: given a slug + body, run the tool and return the
 * response. Defaults to the real @composio/core SDK; tests inject a fake.
 */
export type ComposioExecutor = (
  slug: string,
  body: ComposioExecuteBody,
  options?: { signal?: AbortSignal },
) => Promise<ComposioToolResponse>;

export interface ComposioConfig {
  apiKey: string;
  /** The Composio entity / user id the connected accounts live under. */
  userId?: string;
  /** Test seam: override the transport. Defaults to the @composio/core SDK. */
  executor?: ComposioExecutor;
  timeoutMs?: number;
}

export type ComposioExecuteResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

// One @composio/core client per API key — the SDK is imported lazily so it never
// loads in unit tests (which always inject an executor) or on the client bundle.
const clientCache = new Map<string, Promise<{ tools: { execute: ComposioExecutor } }>>();

function sdkExecutor(apiKey: string): ComposioExecutor {
  return async (slug, body, options) => {
    let clientP = clientCache.get(apiKey);
    if (!clientP) {
      clientP = import("@composio/core").then(({ Composio }) => new Composio({ apiKey }) as unknown as {
        tools: { execute: ComposioExecutor };
      });
      clientCache.set(apiKey, clientP);
    }
    const composio = await clientP;
    return composio.tools.execute(slug, body, options);
  };
}

function errText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
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
 * SDK/network and tool-reported failures all resolve to `{ ok:false }` so a
 * caller can fall back cleanly. On success the tool payload (`response.data`) is
 * returned.
 */
export async function executeComposioTool<T = unknown>(
  config: ComposioConfig,
  toolSlug: string,
  args: Record<string, unknown>,
  opts: { connectedAccountId?: string; userId?: string } = {},
): Promise<ComposioExecuteResult<T>> {
  const executor = config.executor ?? sdkExecutor(config.apiKey);
  const userId =
    opts.userId ?? config.userId ?? process.env[COMPOSIO_USER_ID_ENV] ?? "default";

  const body: ComposioExecuteBody = { userId, arguments: args };
  if (opts.connectedAccountId) body.connectedAccountId = opts.connectedAccountId;

  let signal: AbortSignal | undefined;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    signal = AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  try {
    const res = await executor(toolSlug, body, signal ? { signal } : undefined);
    if (res && res.successful === false) {
      return { ok: false, error: errText(res.error) ?? `Composio ${toolSlug} reported failure.` };
    }
    return { ok: true, data: (res?.data ?? {}) as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Composio ${toolSlug} request failed.`,
    };
  }
}

/**
 * Build a ComposioConfig for an org, or null when Composio is unconfigured.
 * Convenience for connectors that only need the default entity + SDK transport.
 */
export async function composioConfigForOrg(
  orgId?: string,
  overrides: Partial<ComposioConfig> = {},
): Promise<ComposioConfig | null> {
  const apiKey = overrides.apiKey ?? (await resolveComposioApiKey(orgId));
  if (!apiKey) return null;
  return { apiKey, ...overrides };
}
