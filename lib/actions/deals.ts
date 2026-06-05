'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
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

  return { ok: true, deal: data as DealRow };
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
