'use server';

import { revalidatePath } from 'next/cache';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { createDeal } from '@/lib/actions/deals';
import { earnReviewDeal } from '@/lib/diligence';

export type EarnActionResult =
  | { ok: true; message: string; href?: string }
  | { ok: false; error: string };

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
    const res = await createDeal({
      name: dealName,
      stage: typeof input.stage === 'string' ? input.stage : undefined,
      amount: typeof input.amount === 'number' ? input.amount : null
    });
    if (!res.ok) return { ok: false, error: res.error };
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
