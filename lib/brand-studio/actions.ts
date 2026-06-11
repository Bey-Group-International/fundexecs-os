'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import {
  PRESENCE_SETUP_IDS,
  isBrandAssetId,
  sanitizeBrandSpec,
  sanitizeBrandStudioDoc
} from './persistence';

/**
 * lib/brand-studio/actions.ts — persistence for the Profile & Brand studio.
 *
 * The studio edits one jsonb document per org; both actions read-modify-write
 * through the sanitizer so the stored doc can never drift out of shape.
 * Member-scoped through RLS.
 */

export type BrandStudioActionResult = { ok: true } | { ok: false; error: string };

async function patchDoc(
  patch: (doc: ReturnType<typeof sanitizeBrandStudioDoc>) => void
): Promise<BrandStudioActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('brand_studio')
    .select('data')
    .eq('org_id', org.orgId)
    .maybeSingle();

  const doc = sanitizeBrandStudioDoc(row?.data);
  patch(doc);

  const { error } = await supabase
    .from('brand_studio')
    .upsert(
      { org_id: org.orgId, created_by: org.userId, data: doc as unknown as Json },
      { onConflict: 'org_id' }
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/brand');
  revalidatePath('/build');
  return { ok: true };
}

/** Publish (or re-publish) a copiloted brand asset with the operator's spec. */
export async function publishBrandAsset(
  id: string,
  spec: unknown
): Promise<BrandStudioActionResult> {
  if (!isBrandAssetId(id)) return { ok: false, error: 'Unknown brand asset.' };
  return patchDoc((doc) => {
    doc.built[id] = sanitizeBrandSpec(id, spec);
  });
}

/** Mark a presence/setup item live (credentials, domain, company page…). */
export async function setPresenceItem(id: string): Promise<BrandStudioActionResult> {
  if (!PRESENCE_SETUP_IDS.includes(id)) return { ok: false, error: 'Unknown setup item.' };
  return patchDoc((doc) => {
    if (!doc.presence.includes(id)) doc.presence.push(id);
  });
}
