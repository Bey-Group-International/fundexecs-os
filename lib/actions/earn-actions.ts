'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { createDeal } from '@/lib/actions/deals';
import { earnReviewDeal } from '@/lib/diligence';
import type { Json } from '@/lib/supabase/database.types';

export type EarnActionResult =
  | { ok: true; message: string; href?: string }
  | { ok: false; error: string };

/**
 * Log an approved Earn action to the trust-event stream — the closing half of
 * the approve loop: the operator approved, it ran, and now it's on the record.
 * Best-effort: an audit write must never undo or block the action the operator
 * already approved. Surfaces automatically in the Command Center activity feed.
 */
async function logEarnActionApproved(
  orgId: string,
  actorId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from('trust_events').insert({
      org_id: orgId,
      actor_id: actorId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      metadata: metadata as unknown as Json
    });
  } catch {
    // Best-effort — never block the approved action on its audit row.
  }
}

/**
 * Execute a tool action Earn proposed, after the operator confirmed it. Only
 * the mutating tools route here — `navigate` runs client-side. Each branch is
 * auth- and org-scoped and maps to an existing, audited server action, so Earn
 * can't do anything the operator couldn't do themselves.
 */
export async function executeEarnAction(
  name: string,
  input: Record<string, unknown>
): Promise<EarnActionResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Sign in again to let Earn act for you.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  if (name === 'create_deal') {
    const dealName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!dealName) return { ok: false, error: 'A deal name is required.' };
    const stage = typeof input.stage === 'string' ? input.stage : undefined;
    const amount = typeof input.amount === 'number' ? input.amount : null;
    const res = await createDeal({ name: dealName, stage, amount });
    if (!res.ok) return { ok: false, error: res.error };
    await logEarnActionApproved(
      org.orgId,
      user.id,
      'deal',
      res.deal.id,
      'earn_create_deal_approved',
      {
        dealName: res.deal.name,
        stage: stage ?? null,
        amount
      }
    );
    revalidatePath('/pipeline');
    revalidatePath('/command-center');
    return { ok: true, message: `Created “${res.deal.name}” in your pipeline.`, href: '/pipeline' };
  }

  if (name === 'run_diligence') {
    const dealId = typeof input.dealId === 'string' ? input.dealId : '';
    if (!dealId) {
      return {
        ok: false,
        error: 'I need the specific deal. Open it in your Pipeline, then ask me to run diligence.'
      };
    }
    const res = await earnReviewDeal({ orgId: org.orgId, createdBy: user.id, dealId });
    await logEarnActionApproved(
      org.orgId,
      user.id,
      'diligence_run',
      res.runId,
      'earn_run_diligence_approved',
      { dealId, conviction: res.conviction ?? null, status: res.status }
    );
    if (res.status === 'complete') {
      const conviction = res.conviction != null ? ` — conviction ${res.conviction}/100` : '';
      return {
        ok: true,
        message: `The committee finished${conviction}. Memo posted.`,
        href: `/diligence/${res.runId}`
      };
    }
    return {
      ok: true,
      message: 'Diligence run started — review what came back.',
      href: `/diligence/${res.runId}`
    };
  }

  return { ok: false, error: `Earn can't run “${name}” yet.` };
}
