import { createClient } from '@/lib/supabase/server';

export interface BetaInvite {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked';
  note: string | null;
  invitedAt: string;
  lastSentAt: string;
  acceptedAt: string | null;
}

/**
 * List this org's beta invites, newest first. RLS scopes the read to org
 * owners/admins; query errors degrade to an empty list so the admin portal
 * still renders.
 */
export async function getBetaInvites(orgId: string): Promise<BetaInvite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('beta_invites')
    .select('id, email, status, note, invited_at, last_sent_at, accepted_at')
    .eq('org_id', orgId)
    .order('last_sent_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    status: (row.status as BetaInvite['status']) ?? 'pending',
    note: row.note,
    invitedAt: row.invited_at,
    lastSentAt: row.last_sent_at,
    acceptedAt: row.accepted_at
  }));
}
