'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { expiryTimestamp } from '@/lib/dataroom/config';
import { lpRoomKind, type LpRoomTier } from '@/lib/lp-room/public';

/**
 * lib/lp-room/link-actions.ts — minting + revoking the external LP-room share
 * link. Modeled on `lib/dataroom/actions.ts#generateMaterialLink`: a real
 * `data_room_links` row with a server-generated 128-bit token. The LP-room
 * dimension rides on the free-text `material_kind` column as `lp_room:<tier>`,
 * so no schema change is needed. Writes go through the org-scoped RLS client;
 * view logging stays with the public `/lp/[token]` route.
 */

export type LpRoomLinkResult =
  | { ok: true; token: string; expiresAt: string | null }
  | { ok: false; error: string };

function tierLabel(tier: LpRoomTier): string {
  return tier === 'committed' ? 'LP Room · Committed access' : 'LP Room · Prospect access';
}

/** Generate (or return) the live external LP-room link for a tier. An existing
 *  live link of the same tier is reused; expired links are never handed back. */
export async function generateLpRoomLink(
  tier: LpRoomTier,
  expiry?: string
): Promise<LpRoomLinkResult> {
  const safeTier: LpRoomTier = tier === 'committed' ? 'committed' : 'prospect';

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const kind = lpRoomKind(safeTier);
  const nowIso = new Date().toISOString();
  const live = `expires_at.is.null,expires_at.gt.${nowIso}`;

  const { data: existing } = await supabase
    .from('data_room_links')
    .select('token, expires_at')
    .eq('org_id', org.orgId)
    .eq('material_kind', kind)
    .or(live)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, token: existing.token, expiresAt: existing.expires_at };

  // 128-bit token: possession of the URL is the access credential.
  const token = randomBytes(16).toString('base64url');
  const expiresAt = expiryTimestamp(expiry ?? '');
  const { error } = await supabase.from('data_room_links').insert({
    org_id: org.orgId,
    label: tierLabel(safeTier),
    material_kind: kind,
    token,
    // `vetting` is constrained to ('open','accreditation','nda'); LP-room
    // gating is by tier (material_kind), so keep a valid placeholder.
    vetting: 'nda',
    expires_at: expiresAt
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/lp-room');
  return { ok: true, token, expiresAt };
}

/** Kill the live external link(s) for a tier now. The public route honors
 *  `expires_at`, so revocation is immediate. */
export async function revokeLpRoomLink(tier: LpRoomTier): Promise<{ ok: boolean; error?: string }> {
  const safeTier: LpRoomTier = tier === 'committed' ? 'committed' : 'prospect';

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('data_room_links')
    .update({ expires_at: nowIso })
    .eq('org_id', org.orgId)
    .eq('material_kind', lpRoomKind(safeTier))
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/lp-room');
  return { ok: true };
}
