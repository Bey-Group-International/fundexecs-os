'use server';

import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { getFormationState } from '@/lib/queries/formation';
import { getMaterialsStudioData } from '@/lib/queries/materials';
import { getLpPipeline } from '@/lib/queries/lp-pipeline';
import { FORMATION_ITEMS } from '@/lib/formation/config';
import { assessReadinessWithEarn } from '@/lib/ai/fund-readiness';
import type { FundReadinessResult } from '@/lib/capital-formation/fund-readiness';

/* ============================================================================
 * lib/actions/fund-readiness.ts — Earn's institutional readiness read.
 *
 * Gathers the org's live signals (profile completeness + gaps, formation
 * progress, materials, LP pipeline) and asks Earn for a 0–100 readiness score,
 * a verdict, a dimension breakdown, and the three highest-leverage moves. A
 * live read — nothing is persisted.
 * ========================================================================= */

export type AssessReadinessResult =
  | { ok: true; result: FundReadinessResult }
  | { ok: false; error: string };

export async function assessFundReadiness(): Promise<AssessReadinessResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const [profile, formation, materials, pipeline] = await Promise.all([
    getFundProfile(org.orgId),
    getFormationState(org.orgId).catch(() => null),
    getMaterialsStudioData(org.orgId).catch(() => null),
    getLpPipeline(org.orgId).catch(() => null)
  ]);

  const committed = pipeline?.columns.find((c) => c.key === 'committed')?.lps.length ?? 0;
  const softCircled = pipeline?.columns.find((c) => c.key === 'soft_circled')?.lps.length ?? 0;

  const result = await assessReadinessWithEarn({
    fundName: profile.fundName,
    profileCompleteness: profile.completenessScore,
    gaps: profile.gaps.map((g) => ({ label: g.label, severity: g.severity })),
    thesisPresent: Boolean(profile.thesis),
    targetRaise: profile.targetRaise,
    formationCompleted: formation?.completedIds.length ?? 0,
    formationTotal: FORMATION_ITEMS.length,
    materialsReady: materials?.stats.ready ?? 0,
    materialsTotal: materials?.stats.total ?? 0,
    lpTotal: pipeline?.totalLps ?? 0,
    lpCommitted: committed,
    lpSoftCircled: softCircled
  });

  return { ok: true, result };
}
