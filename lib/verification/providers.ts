/**
 * lib/verification/providers.ts — Third-party accredited-investor verification
 * provider adapters.
 *
 * SCAFFOLD — real credentials + a webhook handler are required to go live.
 *
 * This module is deliberately import-safe in all environments: when provider
 * credentials are absent, `isConfigured()` returns false and `createInquiry`
 * returns `{ ok: false, error: '…' }` without making any network request.
 *
 * ─── Supported providers ────────────────────────────────────────────────────
 *
 *   Parallel Markets (https://www.parallelmarkets.com)
 *   · Env var:  PARALLEL_MARKETS_API_KEY
 *   · Docs:     https://developer.parallelmarkets.com/docs/accreditations
 *   · Webhook:  /api/webhooks/parallel-markets  (to be implemented)
 *
 *   VerifyInvestor (https://verifyinvestor.com)
 *   · Env var:  VERIFYINVESTOR_API_KEY
 *   · Docs:     https://verifyinvestor.com/help/api
 *   · Webhook:  /api/webhooks/verifyinvestor  (to be implemented)
 *
 * ─── Integration checklist ──────────────────────────────────────────────────
 *   1. Set the env var(s) above in your Vercel / .env.local.
 *   2. Register the corresponding webhook URL(s) in the provider dashboard.
 *   3. Implement the webhook route(s) to receive status callbacks and update
 *      verification_provider_status + verification_status on raise_interests.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * NOTE: this file must NOT import 'server-only' — it is imported by the server
 * action which already declares 'use server'.  The actual network calls only
 * happen server-side because this module is never bundled for the client
 * (imported exclusively from server actions / server-only query files).
 */

// ---------------------------------------------------------------------------
// Inline resolveServerEnv helper
// (resolveServerEnv in lib/supabase/admin.ts is not exported; we inline a
//  minimal copy here.  If it is later exported, replace this with an import.)
// ---------------------------------------------------------------------------

/**
 * Resolve a server env var by its canonical suffix, tolerating an integration
 * prefix (e.g. `fundexecs_os_PARALLEL_MARKETS_API_KEY` → returns the value).
 */
function resolveServerEnv(suffix: string): string | undefined {
  const exact = process.env[suffix];
  if (exact) return exact;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input required to open an accreditation inquiry with a provider. */
export interface CreateInquiryInput {
  /** Investor email address. */
  email: string;
  /** Investor full name. */
  name: string;
  /**
   * External reference for the inquiry — must be the raise_interests row id so
   * the webhook can map a status callback back to the correct row.
   */
  reference: string;
}

/** Discriminated-union result returned by createInquiry. */
export type CreateInquiryResult =
  | {
      ok: true;
      /** Provider-assigned inquiry / request id (persisted to verification_provider_ref). */
      providerRef: string;
      /** Investor-facing URL to complete verification (may be null for async flows). */
      url: string | null;
      /** Raw provider status string (e.g. 'pending'). */
      status: string;
    }
  | { ok: false; error: string };

/** A pluggable accredited-investor verification provider adapter. */
export interface VerificationProvider {
  id: 'parallel_markets' | 'verifyinvestor';
  /** Human-readable display label. */
  label: string;
  /** Returns true only when the required credentials are present in the environment. */
  isConfigured(): boolean;
  /**
   * Create an accreditation inquiry for the given investor.  Must never throw —
   * errors are returned as `{ ok: false, error }`.
   */
  createInquiry(input: CreateInquiryInput): Promise<CreateInquiryResult>;
}

// ---------------------------------------------------------------------------
// Parallel Markets adapter
// Docs: https://developer.parallelmarkets.com/docs/accreditations
// ---------------------------------------------------------------------------

const PM_API_BASE = 'https://api.parallelmarkets.com/v1';

/**
 * Parallel Markets provider adapter.
 *
 * Set PARALLEL_MARKETS_API_KEY to enable (integration-prefixed names like
 * `fundexecs_os_PARALLEL_MARKETS_API_KEY` are also accepted).
 */
const parallelMarketsProvider: VerificationProvider = {
  id: 'parallel_markets',
  label: 'Parallel Markets',

  isConfigured() {
    return !!resolveServerEnv('PARALLEL_MARKETS_API_KEY');
  },

  async createInquiry(input: CreateInquiryInput): Promise<CreateInquiryResult> {
    const apiKey = resolveServerEnv('PARALLEL_MARKETS_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'Parallel Markets is not configured.' };
    }

    try {
      const response = await fetch(`${PM_API_BASE}/accreditations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          email: input.email,
          name: input.name,
          // 'external_id' maps back to our raise_interests row for webhooks.
          external_id: input.reference,
          // Request accredited-investor status verification.
          type: 'accredited_investor'
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        return { ok: false, error: `Parallel Markets error ${response.status}: ${text}` };
      }

      // Plausible Parallel Markets response shape.
      const body = (await response.json()) as {
        id?: string;
        status?: string;
        accreditation_url?: string | null;
      };

      const providerRef = body.id ?? '';
      const status = body.status ?? 'pending';
      const url = body.accreditation_url ?? null;

      if (!providerRef) {
        return { ok: false, error: 'Parallel Markets returned no inquiry id.' };
      }

      return { ok: true, providerRef, url, status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Parallel Markets request failed: ${message}` };
    }
  }
};

// ---------------------------------------------------------------------------
// VerifyInvestor adapter
// Docs: https://verifyinvestor.com/help/api
// ---------------------------------------------------------------------------

const VI_API_BASE = 'https://verifyinvestor.com/api';

/**
 * VerifyInvestor.com provider adapter.
 *
 * Set VERIFYINVESTOR_API_KEY to enable (integration-prefixed names like
 * `fundexecs_os_VERIFYINVESTOR_API_KEY` are also accepted).
 */
const verifyInvestorProvider: VerificationProvider = {
  id: 'verifyinvestor',
  label: 'VerifyInvestor',

  isConfigured() {
    return !!resolveServerEnv('VERIFYINVESTOR_API_KEY');
  },

  async createInquiry(input: CreateInquiryInput): Promise<CreateInquiryResult> {
    const apiKey = resolveServerEnv('VERIFYINVESTOR_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'VerifyInvestor is not configured.' };
    }

    try {
      const response = await fetch(`${VI_API_BASE}/requests`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          email: input.email,
          full_name: input.name,
          // 'reference' maps back to our raise_interests row for webhooks.
          reference: input.reference
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        return { ok: false, error: `VerifyInvestor error ${response.status}: ${text}` };
      }

      // Plausible VerifyInvestor response shape.
      const body = (await response.json()) as {
        id?: string;
        request_id?: string;
        status?: string;
        verification_url?: string | null;
      };

      const providerRef = body.id ?? body.request_id ?? '';
      const status = body.status ?? 'pending';
      const url = body.verification_url ?? null;

      if (!providerRef) {
        return { ok: false, error: 'VerifyInvestor returned no request id.' };
      }

      return { ok: true, providerRef, url, status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `VerifyInvestor request failed: ${message}` };
    }
  }
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All known adapters, in priority order. */
const ALL_PROVIDERS: VerificationProvider[] = [parallelMarketsProvider, verifyInvestorProvider];

/**
 * Returns the first configured provider (Parallel Markets preferred), or null
 * when neither PARALLEL_MARKETS_API_KEY nor VERIFYINVESTOR_API_KEY is set.
 *
 * The return value is null-safe — callers should guard:
 * ```ts
 * const provider = getConfiguredProvider();
 * if (!provider) return { ok: false, error: 'No verification provider configured.' };
 * ```
 */
export function getConfiguredProvider(): VerificationProvider | null {
  return ALL_PROVIDERS.find((p) => p.isConfigured()) ?? null;
}

/**
 * Retrieve a provider adapter by id, regardless of whether it is configured.
 * Useful when you already know which provider handled a row and want to
 * reference its metadata (label, etc.).
 */
export function getProvider(id: VerificationProvider['id']): VerificationProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}
