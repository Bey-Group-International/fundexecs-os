'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import { MAT_LABEL, expiryTimestamp } from './config';
import { MATERIAL_DB_KIND, isMaterialId, sanitizeMaterialSpec } from './persistence';

/**
 * lib/dataroom/actions.ts — persistence for the Materials & Data Room flow.
 *
 * Materials build into the existing `capital_materials` table (kinds widened
 * by migration; the operator's decisions ride along as `spec`). Link
 * generation writes a real `data_room_links` row with a server-generated
 * token — view logging stays with the public `/dr/[token]` route, so nothing
 * fake ever lands in `data_room_views`.
 */

export type DataRoomActionResult =
  | { ok: true; token?: string; expiresAt?: string | null }
  | { ok: false; error: string };

/** Mark a material built ("Ready") with the operator's spec. Idempotent. */
export async function buildMaterial(id: string, spec: unknown): Promise<DataRoomActionResult> {
  if (!isMaterialId(id)) return { ok: false, error: 'Unknown material.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const kind = MATERIAL_DB_KIND[id];
  const clean = sanitizeMaterialSpec(id, spec) as unknown as Json;
  const now = new Date().toISOString();

  // capital_materials has no (org, kind) uniqueness (the studio allowed
  // many) — update the latest row of this kind, or insert the first.
  const { data: existing } = await supabase
    .from('capital_materials')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('kind', kind)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from('capital_materials')
        .update({ status: 'ready', spec: clean, last_generated_at: now })
        .eq('id', existing.id)
    : await supabase.from('capital_materials').insert({
        org_id: org.orgId,
        created_by: org.userId,
        kind,
        title: MAT_LABEL[id],
        status: 'ready',
        spec: clean,
        last_generated_at: now
      });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/data-room');
  revalidatePath('/build');
  return { ok: true };
}

/** Generate (or return) the live vetted share link for a built material.
 *  Expired/revoked links are never reused — a fresh token is minted. */
export async function generateMaterialLink(
  id: string,
  expiry?: string
): Promise<DataRoomActionResult> {
  if (!isMaterialId(id)) return { ok: false, error: 'Unknown material.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const label = MAT_LABEL[id];
  const kind = MATERIAL_DB_KIND[id];
  const nowIso = new Date().toISOString();
  const live = `expires_at.is.null,expires_at.gt.${nowIso}`;

  const { data: existing } = await supabase
    .from('data_room_links')
    .select('token, expires_at')
    .eq('org_id', org.orgId)
    .eq('material_kind', kind)
    .or(live)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, token: existing.token, expiresAt: existing.expires_at };

  // Rows from before the material_kind column matched by label — adopt the
  // kind so the next lookup is structural.
  const { data: legacy } = await supabase
    .from('data_room_links')
    .select('id, token, expires_at')
    .eq('org_id', org.orgId)
    .is('material_kind', null)
    .eq('label', label)
    .or(live)
    .limit(1)
    .maybeSingle();
  if (legacy) {
    // If the kind upgrade fails the row stays structurally untracked, and
    // revokeMaterialLink() (which filters on material_kind) could never reach
    // it — surface the error instead of handing back an unrevocable token.
    const { error: upgradeError } = await supabase
      .from('data_room_links')
      .update({ material_kind: kind })
      .eq('id', legacy.id);
    if (upgradeError) return { ok: false, error: upgradeError.message };
    return { ok: true, token: legacy.token, expiresAt: legacy.expires_at };
  }

  // 128-bit token: possession of the URL is the access credential.
  const token = randomBytes(16).toString('base64url');
  const expiresAt = expiryTimestamp(expiry ?? '');
  const { error } = await supabase.from('data_room_links').insert({
    org_id: org.orgId,
    label,
    material_kind: kind,
    token,
    vetting: 'nda',
    expires_at: expiresAt
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/data-room');
  return { ok: true, token, expiresAt };
}

/** Kill a material's live share link(s) now. The public route already honors
 *  `expires_at`, so revocation is immediate; logged views stay on the record. */
export async function revokeMaterialLink(id: string): Promise<DataRoomActionResult> {
  if (!isMaterialId(id)) return { ok: false, error: 'Unknown material.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('data_room_links')
    .update({ expires_at: nowIso })
    .eq('org_id', org.orgId)
    .eq('material_kind', MATERIAL_DB_KIND[id])
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/data-room');
  return { ok: true };
}
