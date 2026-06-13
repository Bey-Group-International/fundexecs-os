'use server';

import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { draftRebuttalWithEarn } from '@/lib/ai/objection-rebuttal';
import type { ObjectionRebuttalResult } from '@/lib/capital-formation/objection-rebuttal';

/* ============================================================================
 * lib/actions/objection-rebuttal.ts — draft a rebuttal to an LP objection.
 *
 * Grounds Earn (Eleanor) in the org's fund profile, then drafts a response +
 * talking points for the objection. Returns the draft for the operator to
 * adapt; persistence is the operator's call via `upsertObjection`.
 * ========================================================================= */

export interface DraftRebuttalInput {
  objection: string;
  category: string;
  lpName?: string | null;
}

export type DraftRebuttalResult =
  | { ok: true; result: ObjectionRebuttalResult }
  | { ok: false; error: string };

export async function draftObjectionRebuttal(
  input: DraftRebuttalInput
): Promise<DraftRebuttalResult> {
  const objection = input.objection?.trim();
  if (!objection) return { ok: false, error: 'Enter the objection first.' };

  const category = input.category?.trim() || 'General';

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const profile = await getFundProfile(org.orgId).catch(() => null);

  const result = await draftRebuttalWithEarn({
    objection: objection.slice(0, 2000),
    category,
    lpName: input.lpName?.trim() || null,
    fund: {
      name: profile?.fundName ?? 'your fund',
      thesis: profile?.thesis ?? null,
      strategy: profile?.strategy ?? null
    }
  });

  return { ok: true, result };
}
