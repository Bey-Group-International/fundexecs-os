import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Best-effort: record a peer referral for a freshly signed-in user from a
 * captured `/r/<code>` cookie. Resolves the code to its owner (referrer) and
 * calls `record_referral` with source 'peer'.
 *
 * Idempotent and safe to call on every sign-in: `record_referral` is first-touch
 * (a repeat is a no-op) and skips self / same-org, so a returning user who still
 * carries the cookie never mis-attributes. Never throws — referral capture must
 * never block sign-in.
 */
export async function recordPeerReferral(referredUserId: string, code: string): Promise<void> {
  if (!referredUserId || !code) return;
  try {
    const admin = createAdminClient();
    const { data: owner } = await admin
      .from('user_referral_codes')
      .select('user_id, org_id')
      .eq('code', code)
      .maybeSingle();
    if (!owner?.user_id || !owner.org_id) return;

    // `_source_id` defaults to null in the RPC — omit it for peer referrals.
    await admin.rpc('record_referral', {
      _referred_user_id: referredUserId,
      _referrer_user_id: owner.user_id,
      _referrer_org_id: owner.org_id,
      _source: 'peer'
    });
  } catch {
    // Referral capture is best-effort — never block the sign-in.
  }
}
