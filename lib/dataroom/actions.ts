'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import { MAT_LABEL } from './config';
import { MATERIAL_DB_KIND, isMaterialId, sanitizeMaterialSpec } from './persistence';

/**
 * lib/dataroom/actions.ts — persistence for the Materials & Data Room flow.
 *
 * Materials build into the existing `capital_materials` table (kinds widened
 * by migration; the operator's decisions ride along as `spec`). Link
 * generation writes a real `data_room_links` row with a server-generated
 * token — view logging stays with the future public `/dr/[token]` route, so
 * nothing fake ever lands in `data_room_views`.
 */

export type DataRoomActionResult = { ok: true; token?: string } | { ok: false; error: string };

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

/** Generate (or return) the vetted share link for a built material. */
export async function generateMaterialLink(id: string): Promise<DataRoomActionResult> {
  if (!isMaterialId(id)) return { ok: false, error: 'Unknown material.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const label = MAT_LABEL[id];

  const { data: existing } = await supabase
    .from('data_room_links')
    .select('token')
    .eq('org_id', org.orgId)
    .eq('label', label)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, token: existing.token };

  const token = randomBytes(6).toString('base64url');
  const { error } = await supabase.from('data_room_links').insert({
    org_id: org.orgId,
    label,
    token,
    vetting: 'nda'
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/data-room');
  return { ok: true, token };
}
