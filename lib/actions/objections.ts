'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

/* ============================================================================
 * lib/actions/objections.ts — Objections mutations.
 *
 * Thin wrappers over the EXISTING `upsert_objection` / `resolve_objection`
 * RPCs (no raw SQL, no migrations). Every action resolves the active org,
 * validates input, calls the RPC via the RLS-scoped server client, and returns
 * a discriminated result the client can branch on.
 * ========================================================================= */

export type ObjectionActionResult = { ok: true; id: string } | { ok: false; error: string };

export interface UpsertObjectionInput {
  /** Omit to create; pass an existing id to edit in place. */
  id?: string;
  lpId: string;
  category: string;
  objection: string;
  rebuttal?: string;
  status?: string;
}

/**
 * Create or update an objection via `upsert_objection`. The RPC scopes the
 * write to the caller's org through RLS; we still pass `_org_id` because the
 * function signature requires it.
 */
export async function upsertObjection(input: UpsertObjectionInput): Promise<ObjectionActionResult> {
  const objection = input.objection?.trim();
  if (!objection) return { ok: false, error: 'Objection text is required.' };

  const category = input.category?.trim();
  if (!category) return { ok: false, error: 'Category is required.' };

  const lpId = input.lpId?.trim();
  if (!lpId) return { ok: false, error: 'Select the LP this objection is tied to.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('upsert_objection', {
    _org_id: org.orgId,
    _lp_id: lpId,
    _category: category,
    _objection: objection,
    _rebuttal: input.rebuttal?.trim() || undefined,
    _status: input.status?.trim() || undefined,
    ...(input.id ? { _id: input.id } : {})
  });

  if (error) return { ok: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) return { ok: false, error: 'Could not save objection.' };
  return { ok: true, id: row.id };
}

/**
 * Mark an objection resolved via `resolve_objection` (sets status + the
 * `resolved_at` timestamp server-side).
 */
export async function resolveObjection(id: string): Promise<ObjectionActionResult> {
  if (!id) return { ok: false, error: 'Missing objection id.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('resolve_objection', { _id: id });

  if (error) return { ok: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) return { ok: false, error: 'Could not resolve objection.' };
  return { ok: true, id: row.id };
}

/**
 * Re-open a previously-resolved objection by upserting it back to `open`.
 * Reuses `upsert_objection` (the only write path) rather than touching SQL.
 */
export async function reopenObjection(input: {
  id: string;
  lpId: string;
  category: string;
  objection: string;
  rebuttal?: string;
}): Promise<ObjectionActionResult> {
  return upsertObjection({ ...input, status: 'open' });
}
