'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
import { recordLoopClose } from '@/lib/actions/loop';
import { DEAL_STAGE_VERB, LOOP_EVENT_TYPES } from '@/lib/loop-events';
import { emitLoopEvent } from '@/lib/loop-events.server';
import type { Database } from '@/lib/supabase/database.types';

type DealRow = Database['public']['Tables']['deals']['Row'];
type DealInsert = Database['public']['Tables']['deals']['Insert'];
type DealUpdate = Database['public']['Tables']['deals']['Update'];

export type DealActionResult<T = DealRow> = { ok: true; deal: T } | { ok: false; error: string };

export interface CreateDealInput {
  name: string;
  stage?: string;
  status?: string;
  amount?: number | null;
}

const VALID_STAGES = [
  'sourcing',
  'screening',
  'visitor',
  'prospect',
  'qualified',
  'meeting',
  'diligence',
  'soft-circle',
  'ic',
  'execution',
  'closing',
  'committed',
  'closed'
];

function validateStage(stage: string): string {
  const s = stage.trim().toLowerCase();
  return VALID_STAGES.includes(s) ? s : 'sourcing';
}

/**
 * Create a new deal in the active org. Returns the inserted row on success.
 * No XP fires on create — XP rewards happen at stage advancement (concept,
 * execution, work layers).
 */
export async function createDeal(input: CreateDealInput): Promise<DealActionResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const insert: DealInsert = {
    org_id: org.orgId,
    name,
    stage: validateStage(input.stage ?? 'sourcing'),
    status: input.status?.trim() || 'open',
    amount: input.amount ?? null,
    owner_id: org.userId
  };

  const { data, error } = await supabase.from('deals').insert(insert).select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  // Instrument Source doing its job: a new deal entered the funnel. Best-effort
  // (emitLoopEvent never throws) — feeds the Source hub's pulse.
  await emitLoopEvent({
    orgId: org.orgId,
    verb: 'source',
    eventType: LOOP_EVENT_TYPES.dealCreated,
    entityType: 'deal',
    entityId: (data as DealRow).id,
    // Null means "unsized", not $0 — consumers can tell the two apart.
    metadata: { amount: input.amount ?? null, stage: insert.stage ?? 'sourcing' }
  });

  return { ok: true, deal: data as DealRow };
}

export interface UpdateDealInput {
  name?: string;
  amount?: number | null;
  status?: string;
}

export async function updateDeal(
  dealId: string,
  patch: UpdateDealInput
): Promise<DealActionResult> {
  if (!dealId) return { ok: false, error: 'Missing deal id.' };

  const supabase = await createClient();
  const update: DealUpdate = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return { ok: false, error: 'Name cannot be empty.' };
    update.name = trimmed;
  }
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.status !== undefined) update.status = patch.status.trim() || 'open';

  if (Object.keys(update).length === 0) {
    return { ok: false, error: 'Nothing to update.' };
  }

  const { data, error } = await supabase
    .from('deals')
    .update(update)
    .eq('id', dealId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Update failed.' };
  return { ok: true, deal: data as DealRow };
}

/**
 * Dedicated stage transition. Fires the right Chain-of-Trust XP based on
 * the target stage. XP awards are wrapped — a failed `award_trust_xp` call
 * does not abort the stage change.
 */
export async function updateDealStage(
  dealId: string,
  nextStage: string
): Promise<DealActionResult> {
  if (!dealId) return { ok: false, error: 'Missing deal id.' };
  const stage = validateStage(nextStage);

  const supabase = await createClient();
  const update: DealUpdate = { stage };
  // Auto-flip status to 'won' when the deal closes, so the pipeline KPI
  // tiles (committed / closed) include it without an extra mutation.
  if (stage === 'closed') update.status = 'won';

  const { data, error } = await supabase
    .from('deals')
    .update(update)
    .eq('id', dealId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Stage update failed.' };

  try {
    if (stage === 'closed') {
      await awardTrustXp({ layer: 'work', entityType: 'deal', entityId: dealId });
    } else if (stage === 'execution' || stage === 'closing') {
      await awardTrustXp({ layer: 'execution', entityType: 'deal', entityId: dealId });
    } else if (stage === 'diligence') {
      await awardTrustXp({ layer: 'concept', entityType: 'deal', entityId: dealId });
    }
  } catch {
    // XP rewards are best-effort; never block the parent action.
  }

  // Instrument the funnel's heartbeat: every stage move lands on the per-verb
  // loop_events stream (Source for top-of-funnel, Run for diligence/IC, Drive
  // for the close-out stages). Best-effort — feeds the hubs' pulses, including
  // Run's decision velocity (time from entering diligence to the decision).
  const row = data as DealRow;
  await emitLoopEvent({
    orgId: row.org_id,
    verb: DEAL_STAGE_VERB[stage] ?? 'source',
    eventType: LOOP_EVENT_TYPES.dealStage,
    entityType: 'deal',
    entityId: dealId,
    // Null means "unsized", not $0 — consumers can tell the two apart.
    metadata: { stage, amount: row.amount ?? null }
  });

  // Close the loop: a closed deal is proof of work — feed it back into the
  // member record so readiness rises. Idempotent + best-effort. The amount
  // rides along so the Drive pulse can read dollars closed from the stream.
  if (stage === 'closed') {
    try {
      await recordLoopClose({
        source: 'deal_closed',
        entityType: 'deal',
        entityId: dealId,
        metadata: { name: row.name, amount: row.amount ?? null }
      });
    } catch {
      // Never block the stage change on the flywheel write.
    }
  }

  return { ok: true, deal: row };
}

export type DealNoteResult = { ok: true; noteId: string } | { ok: false; error: string };

/**
 * Log a member-authored note against a deal. Notes are append-only — the
 * drawer's activity timeline renders them interleaved with the deal's
 * loop_events history, so the record stays immutable once written.
 */
export async function addDealNote(dealId: string, body: string): Promise<DealNoteResult> {
  if (!dealId) return { ok: false, error: 'Missing deal id.' };
  const trimmed = body?.trim() ?? '';
  if (!trimmed) return { ok: false, error: 'Note cannot be empty.' };
  if (trimmed.length > 2000) return { ok: false, error: 'Note is too long (2000 max).' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('deal_notes')
    .insert({ org_id: org.orgId, deal_id: dealId, author_id: org.userId, body: trimmed })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Note insert failed.' };
  return { ok: true, noteId: (data as { id: string }).id };
}

/**
 * Soft-delete a deal by setting status='archived'. The brief reserves hard
 * delete for explicit owner workflows; the day-to-day "delete" is archive.
 */
export async function archiveDeal(dealId: string): Promise<DealActionResult> {
  if (!dealId) return { ok: false, error: 'Missing deal id.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('deals')
    .update({ status: 'archived' })
    .eq('id', dealId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Archive failed.' };
  return { ok: true, deal: data as DealRow };
}
