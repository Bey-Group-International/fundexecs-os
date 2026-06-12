'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import { FORMATION_ITEMS, type FormationKind } from './config';
import { sanitizeFormationData } from './persistence';
import {
  FORMATION_MATERIAL_KIND,
  FORMATION_MATERIAL_TITLE,
  formationStepSpec,
  orderingError
} from './steps';

/**
 * lib/formation/actions.ts — persistence for the copiloted formation flow.
 *
 * The operator drives this surface through the wizard's own approve loop
 * (decide → explicit "Complete & file" approval → this action; only success
 * advances), so writes are member-scoped through RLS. "Filing" remains
 * illustrative — no real filing leaves the platform — but what persists is
 * real: the working document (`fund_formations`), the step record
 * (`formation_steps`, versioned on amendment), a Chain of Trust record per
 * filed step, and a data-room document (`capital_materials`) the Materials
 * tab can surface. Step ordering is enforced here, not just in the UI.
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

/**
 * Persist the working document and put one step on the record:
 *
 * 1. Ordering is enforced here — earlier steps must already be filed.
 * 2. The step's drafted document becomes a `capital_materials` row (Legal &
 *    Terms / Fund Overview), idempotently — re-filing updates, never
 *    duplicates. The bank step produces no document.
 * 3. A `chain_of_trust_records` row (plus its proof layers) backs the
 *    "logged to your Chain of Trust" line with real rows.
 * 4. Re-filing an already-recorded step is an amendment: `version` bumps and
 *    `amended_at` is stamped — the original `filed_at` is never rewritten —
 *    and a fresh `trust_events` entry records it.
 *
 * When the seventh step lands, the formation flips to `formed`.
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
  const now = new Date().toISOString();

  const { data: stepRows, error: stepsErr } = await supabase
    .from('formation_steps')
    .select('id, kind, version, filed_at, amended_at')
    .eq('org_id', org.orgId);
  if (stepsErr) return { ok: false, error: stepsErr.message };

  const existing = (stepRows ?? []).find((r) => r.kind === kind) ?? null;

  // Server-enforced ordering — amending an already-filed step is always
  // allowed (it is already on the record); a first filing must be in order.
  if (!existing) {
    const filed = new Set((stepRows ?? []).map((r) => r.kind as FormationKind));
    const orderErr = orderingError(kind, filed);
    if (orderErr) return { ok: false, error: orderErr };
  }

  const { error: docErr } = await supabase
    .from('fund_formations')
    .upsert(
      { org_id: org.orgId, created_by: org.userId, data: data as unknown as Json },
      { onConflict: 'org_id' }
    );
  if (docErr) return { ok: false, error: docErr.message };

  // The step row. A retry of an interrupted first filing (step row written,
  // chain record not yet) completes the filing rather than counting as an
  // amendment, so `amended` is decided by whether the chain record exists.
  let stepId: string;
  let filedAt: string;
  if (existing) {
    stepId = existing.id;
    filedAt = existing.filed_at;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('formation_steps')
      .insert({ org_id: org.orgId, kind, filed_by: org.userId, filed_at: now })
      .select('id, filed_at')
      .single();
    if (insErr || !inserted) return { ok: false, error: insErr?.message ?? 'Filing failed.' };
    stepId = inserted.id;
    filedAt = inserted.filed_at;
  }

  const { data: chain, error: chainReadErr } = await supabase
    .from('chain_of_trust_records')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('entity_type', 'formation_step')
    .eq('entity_id', stepId)
    .maybeSingle();
  if (chainReadErr) return { ok: false, error: chainReadErr.message };
  const amended = !!existing && !!chain;

  // Data-room filing: the drafted document, with the step's decisions as its
  // spec, lands in capital_materials so the Materials & data room tab can
  // surface it. Idempotent — the latest row of the kind is updated.
  const materialKind = FORMATION_MATERIAL_KIND[kind];
  if (materialKind) {
    const spec = formationStepSpec(kind, data) as unknown as Json;
    const title = FORMATION_MATERIAL_TITLE[kind] ?? kind;
    const { data: material, error: matReadErr } = await supabase
      .from('capital_materials')
      .select('id')
      .eq('org_id', org.orgId)
      .eq('kind', materialKind)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (matReadErr) return { ok: false, error: matReadErr.message };
    const { error: matErr } = material
      ? await supabase
          .from('capital_materials')
          .update({ title, spec, status: 'ready', last_generated_at: now })
          .eq('id', material.id)
      : await supabase.from('capital_materials').insert({
          org_id: org.orgId,
          created_by: org.userId,
          kind: materialKind,
          title,
          status: 'ready',
          spec,
          last_generated_at: now
        });
    if (matErr) return { ok: false, error: matErr.message };
  }

  // Chain of Trust: one real record per step (the Complete screen's "logged
  // to your Chain of Trust" line), shaped like lib/actions/trust.ts records.
  if (!chain) {
    const { data: record, error: chainErr } = await supabase
      .from('chain_of_trust_records')
      .insert({
        org_id: org.orgId,
        entity_type: 'formation_step',
        entity_id: stepId,
        current_layer: 'Proof of Truth',
        completion_percentage: 0,
        status: 'active'
      })
      .select('id')
      .single();
    if (chainErr || !record) {
      return { ok: false, error: chainErr?.message ?? 'Chain of Trust logging failed.' };
    }
    const layers = ['Proof of Truth', 'Proof of Concept', 'Proof of Execution', 'Proof of Work'];
    const { error: layersErr } = await supabase.from('proof_layers').insert(
      layers.map((layer_name, i) => ({
        org_id: org.orgId,
        chain_record_id: record.id,
        layer_name,
        layer_order: i + 1,
        required_documents: [],
        required_tasks: [],
        human_approval_status: 'pending',
        completion_percentage: 0
      }))
    );
    if (layersErr) return { ok: false, error: layersErr.message };
  }

  // Amendments never rewrite history: filed_at stays, version bumps,
  // amended_at marks the change.
  let version = existing?.version ?? 1;
  if (amended) {
    version += 1;
    const { error: amendErr } = await supabase
      .from('formation_steps')
      .update({ version, amended_at: now, filed_by: org.userId })
      .eq('id', stepId);
    if (amendErr) return { ok: false, error: amendErr.message };
  }

  // Fresh audit entry per filing/amendment (best-effort, like trust.ts).
  try {
    await supabase.from('trust_events').insert({
      org_id: org.orgId,
      actor_id: org.userId,
      entity_type: 'formation_step',
      entity_id: stepId,
      action: amended ? 'formation_step_amended' : 'formation_step_filed',
      metadata: { kind, version }
    });
  } catch {
    // best-effort
  }

  // Formed once every step kind is on the record.
  const { count } = await supabase
    .from('formation_steps')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.orgId);
  const formed = (count ?? 0) >= FORMATION_ITEMS.length;
  if (formed) {
    await supabase.from('fund_formations').update({ status: 'formed' }).eq('org_id', org.orgId);
  }

  revalidatePath('/build/formation');
  revalidatePath('/build');
  revalidatePath('/command-center');
  return {
    ok: true,
    formed,
    version,
    amended,
    filedAt,
    amendedAt: amended ? now : (existing?.amended_at ?? null)
  };
}
