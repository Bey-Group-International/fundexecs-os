'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
import type { Database } from '@/lib/supabase/database.types';

type AllocationRow = Database['public']['Tables']['allocations']['Row'];
type AllocationInsert = Database['public']['Tables']['allocations']['Insert'];
type AllocationUpdate = Database['public']['Tables']['allocations']['Update'];

export type AllocationActionResult<T = AllocationRow> =
  | { ok: true; allocation: T }
  | { ok: false; error: string };

export interface CreateAllocationInput {
  dealId: string;
  lpOrgId?: string | null;
  amount: number;
  status?: string;
}

const VALID_STATUSES = ['proposed', 'accepted', 'declined', 'committed', 'closed'];

/**
 * Log a new allocation against a deal. Fires concept-layer XP on success
 * (a soft-circle / pencil-in commitment advances the Chain-of-Trust).
 */
export async function createAllocation(
  input: CreateAllocationInput
): Promise<AllocationActionResult> {
  if (!input.dealId) return { ok: false, error: 'Missing deal id.' };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: 'Amount must be a positive number.' };
  }
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const insert: AllocationInsert = {
    org_id: org.orgId,
    deal_id: input.dealId,
    lp_id: input.lpOrgId ?? null,
    amount: input.amount,
    status: VALID_STATUSES.includes(input.status ?? '') ? (input.status as string) : 'proposed'
  };
  const { data, error } = await supabase.from('allocations').insert(insert).select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  try {
    await awardTrustXp({ layer: 'concept', entityType: 'allocation', entityId: data.id });
  } catch {
    // XP is best-effort.
  }
  return { ok: true, allocation: data as AllocationRow };
}

export interface UpdateAllocationInput {
  amount?: number;
  status?: string;
}

export async function updateAllocation(
  allocationId: string,
  patch: UpdateAllocationInput
): Promise<AllocationActionResult> {
  if (!allocationId) return { ok: false, error: 'Missing allocation id.' };

  const supabase = await createClient();
  const update: AllocationUpdate = {};
  if (patch.amount !== undefined) {
    if (!Number.isFinite(patch.amount) || patch.amount <= 0) {
      return { ok: false, error: 'Amount must be a positive number.' };
    }
    update.amount = patch.amount;
  }
  if (patch.status !== undefined && VALID_STATUSES.includes(patch.status)) {
    update.status = patch.status;
  }
  if (Object.keys(update).length === 0) return { ok: false, error: 'Nothing to update.' };

  const { data, error } = await supabase
    .from('allocations')
    .update(update)
    .eq('id', allocationId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Update failed.' };
  return { ok: true, allocation: data as AllocationRow };
}

/**
 * Hard-delete an allocation. The brief reserves deletion for error
 * correction — allocations are commitments and lifecycle changes should
 * use `updateAllocation` with a 'declined' / 'closed' status instead.
 */
export async function deleteAllocation(
  allocationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!allocationId) return { ok: false, error: 'Missing allocation id.' };

  const supabase = await createClient();
  const { error } = await supabase.from('allocations').delete().eq('id', allocationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
