import { createAdminClient } from '@/lib/supabase/admin';

export interface InviteWelcome {
  /** Display name of the admin who sent the invite, for "{inviter} invited you". */
  inviterName: string | null;
}

/**
 * Resolve the safe welcome context for an email-invited user who just landed
 * post-auth at /beta/welcome. Looks up their most recent `beta_invites` row by
 * email (service-role — a fresh beta user owns their own org and can't read the
 * inviting org's invites under RLS) and returns only the inviter's display name.
 * Best-effort: any miss returns null and the page shows a generic welcome.
 */
export async function getInviteWelcome(
  email: string | null | undefined
): Promise<InviteWelcome | null> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  try {
    const admin = createAdminClient();
    const { data: invite } = await admin
      .from('beta_invites')
      .select('invited_by')
      .eq('email', normalized)
      .order('last_sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!invite?.invited_by) return null;

    const { data: inviter } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', invite.invited_by)
      .maybeSingle();

    return { inviterName: inviter?.full_name?.trim() || null };
  } catch (error) {
    console.error('[invite-welcome] failed to resolve inviter', error);
    return null;
  }
}
