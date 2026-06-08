import { createAdminClient } from '@/lib/supabase/admin';
import type { BetaInviteContext } from '@/lib/beta/welcome';

/**
 * Resolve the safe, public welcome context for a shareable beta-link token so
 * the claim page can greet the invitee personally ("{inviter} invited you ·
 * {label}"). Service-role read because the page is pre-auth; it selects only the
 * non-sensitive label + inviter display name and nothing about the org or fund.
 * Best-effort: any miss returns null and the page falls back to a generic
 * welcome. Claimability (revoked/expired/full) is still enforced at claim time.
 */
export async function getBetaLinkWelcome(token: string): Promise<BetaInviteContext | null> {
  if (!token) return null;
  try {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from('beta_links')
      .select('label, created_by')
      .eq('token', token)
      .maybeSingle();
    if (!link) return null;

    let inviterName: string | null = null;
    if (link.created_by) {
      const { data: creator } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', link.created_by)
        .maybeSingle();
      inviterName = creator?.full_name?.trim() || null;
    }

    return { label: link.label?.trim() || null, inviterName };
  } catch {
    return null;
  }
}
