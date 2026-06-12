'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMandate } from '@/lib/queries/mandate';
import type { Json } from '@/lib/supabase/database.types';
import { FORMATION_ITEMS, type FormationKind } from './config';
import { composeFormationDoc, renderFormationDoc } from './compose';
import { sanitizeFormationData } from './persistence';
import { formationStepSpec } from './steps';

/**
 * lib/formation/actions.ts — persistence for the copiloted formation flow.
 *
 * The operator drives this surface through the wizard's own approve loop
 * (decide → explicit "Complete & file" approval → this action; only success
 * advances). "Filing" remains illustrative — no real filing leaves the
 * platform — but what persists is real and now **atomic**: one
 * `file_formation_step` RPC wraps the step record, Chain of Trust record +
 * proof layers, data-room material, the immutable per-version document
 * snapshot, the audit entry and the formed flip in a single transaction
 * (see 20260612120000_formation_atomic_filing.sql). Ordering is enforced
 * there, not just in the UI, and a filing can never partially land.
 */

export type FormationActionResult = { ok: true; formed: boolean } | { ok: false; error: string };

export type FormationFileResult =
  | {
      ok: true;
      formed: boolean;
      version: number;
      amended: boolean;
      filedAt: string;
      amendedAt: string | null;
    }
  | { ok: false; error: string };

const VALID_KINDS = new Set<FormationKind>(FORMATION_ITEMS.map((i) => i.kind));

/** Upsert the working document (the "Save & close" path). Best-effort. */
export async function saveFormationDraft(input: unknown): Promise<FormationActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const data = sanitizeFormationData(input) as unknown as Json;
  const { error } = await supabase
    .from('fund_formations')
    .upsert({ org_id: org.orgId, created_by: org.userId, data }, { onConflict: 'org_id' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/formation');
  return { ok: true, formed: false };
}

/** Shape-check the RPC's jsonb result without trusting it blindly. */
function parseFileResult(raw: unknown): {
  version: number;
  amended: boolean;
  filedAt: string;
  amendedAt: string | null;
  formed: boolean;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'number' || typeof r.filed_at !== 'string') return null;
  return {
    version: r.version,
    amended: r.amended === true,
    filedAt: r.filed_at,
    amendedAt: typeof r.amended_at === 'string' ? r.amended_at : null,
    formed: r.formed === true
  };
}

/**
 * Persist the working document and put one step on the record — atomically.
 *
 * The RPC enforces step ordering (earlier steps must already be filed; the
 * error message surfaces in the wizard), records first filings at version 1,
 * and treats re-filing as an amendment: `version` bumps, `amended_at` is
 * stamped, the original `filed_at` is never rewritten, and the previous
 * document snapshot stays behind in `capital_material_versions`. When the
 * seventh step lands, the formation flips to `formed`.
 */
export async function fileFormationStep(
  kind: FormationKind,
  input: unknown
): Promise<FormationFileResult> {
  if (!VALID_KINDS.has(kind)) return { ok: false, error: 'Unknown formation step.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const data = sanitizeFormationData(input);
  const spec = formationStepSpec(kind, data);

  // The stored per-version snapshot body: the same drafted document the
  // Review screen composes, rendered to text from the sanitized decisions.
  const mandate = await getMandate(org.orgId);
  const doc = composeFormationDoc(kind, data, { firm: mandate?.firm ?? 'your fund' });

  const { data: raw, error } = await supabase.rpc('file_formation_step', {
    _org_id: org.orgId,
    _kind: kind,
    _data: data as unknown as Json,
    _spec: spec as unknown as Json,
    _doc_body: renderFormationDoc(doc)
  });
  if (error) return { ok: false, error: error.message };

  const res = parseFileResult(raw);
  if (!res) return { ok: false, error: 'Filing returned an unexpected result — try again.' };

  revalidatePath('/build/formation');
  revalidatePath('/build');
  revalidatePath('/command-center');
  return { ok: true, ...res };
}
