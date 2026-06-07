import { createClient } from '@/lib/supabase/server';

export type BetaLinkStatus = 'active' | 'revoked' | 'expired' | 'full';

export interface BetaLinkWithStatus {
  id: string;
  label: string | null;
  role: string;
  maxUses: number;
  claimsCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  status: BetaLinkStatus;
}

/**
 * List this org's beta links (newest first) with a derived status and live
 * claim count. RLS scopes the read to org owners/admins; failures degrade to an
 * empty list so the admin portal still renders. Claim counts are tallied in a
 * single companion query to avoid per-row round-trips.
 */
export async function getBetaLinks(orgId: string): Promise<BetaLinkWithStatus[]> {
  const supabase = await createClient();

  const { data: links, error } = await supabase
    .from('beta_links')
    .select('id, label, role, max_uses, expires_at, revoked_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error || !links) return [];

  const { data: claims } = await supabase
    .from('beta_link_claims')
    .select('beta_link_id')
    .eq('org_id', orgId);

  const counts = new Map<string, number>();
  for (const c of claims ?? []) {
    counts.set(c.beta_link_id, (counts.get(c.beta_link_id) ?? 0) + 1);
  }

  const now = Date.now();
  return links.map((row) => {
    const claimsCount = counts.get(row.id) ?? 0;
    const status: BetaLinkStatus = row.revoked_at
      ? 'revoked'
      : new Date(row.expires_at).getTime() <= now
        ? 'expired'
        : claimsCount >= row.max_uses
          ? 'full'
          : 'active';
    return {
      id: row.id,
      label: row.label,
      role: row.role,
      maxUses: row.max_uses,
      claimsCount,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      status
    };
  });
}
