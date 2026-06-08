'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfiguredProvider } from '@/lib/verification/providers';

/* ============================================================================
 * lib/actions/raise-provider-verification.ts — third-party accreditation
 * verification scaffold for 506(c) raises.
 *
 * Triggers a verification inquiry via the first configured provider adapter
 * (Parallel Markets → VerifyInvestor; see lib/verification/providers.ts) and
 * records the resulting provider ref, URL, and status on the raise_interests
 * row, advancing verification_status to 'pending'.
 *
 * Never-block pattern: when no provider is configured the action returns a
 * clear error message rather than throwing, keeping the UI fully functional
 * without credentials.
 *
 * AUTHZ: the authed client select enforces the owner/admin RLS policy — only
 * org owners/admins can see (and therefore initiate verification for) a row.
 * The subsequent update goes through the admin client to bypass RLS (the RLS
 * policy only allows update of verification decision fields by authenticated
 * users, but the provider write adds new columns that may not be covered).
 * ========================================================================= */

export type InitiateProviderVerificationResult =
  | { ok: true; url: string | null; provider: string; status: string }
  | { ok: false; error: string };

/**
 * Initiate a third-party accreditation verification for a raise_interests row.
 *
 * @param interestId - The raise_interests.id to verify.
 * @returns A result object — never throws to the client.
 */
export async function initiateProviderVerification(
  interestId: string
): Promise<InitiateProviderVerificationResult> {
  if (!interestId) return { ok: false, error: 'Missing reservation id.' };

  // ── 1. Authz: fetch the row under RLS (owner/admin only). ──────────────────
  const supabase = await createClient();
  const { data: interest, error: selectError } = await supabase
    .from('raise_interests')
    .select('id, org_id, name, email')
    .eq('id', interestId)
    .maybeSingle();

  if (selectError || !interest) {
    return { ok: false, error: 'Not found or not authorized.' };
  }

  // ── 2. Check a provider is configured. ────────────────────────────────────
  const provider = getConfiguredProvider();
  if (!provider) {
    return {
      ok: false,
      error:
        'No verification provider is configured. Add PARALLEL_MARKETS_API_KEY or VERIFYINVESTOR_API_KEY.'
    };
  }

  // ── 3. Open the inquiry with the provider. ─────────────────────────────────
  const result = await provider.createInquiry({
    email: interest.email,
    name: interest.name,
    reference: interest.id
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // ── 4. Persist provider fields + advance verification_status to 'pending'. ─
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from('raise_interests')
    .update({
      verification_provider: provider.id,
      verification_provider_ref: result.providerRef,
      verification_provider_url: result.url,
      verification_provider_status: result.status,
      // The provider is now the system of record — move to pending.
      verification_status: 'pending'
    })
    .eq('id', interest.id);

  if (updateError) {
    // The inquiry was created with the provider but we couldn't persist it —
    // surface a clear message so the admin can retry.
    return {
      ok: false,
      error: `Provider inquiry created (ref: ${result.providerRef}) but could not be saved: ${updateError.message}`
    };
  }

  return { ok: true, url: result.url, provider: provider.id, status: result.status };
}
