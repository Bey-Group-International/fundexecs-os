import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getStrategyData } from '@/lib/queries/strategy';
import { getComplianceLane } from '@/lib/queries/compliance';
import { getDashboardData } from '@/lib/queries/dashboard/lifecycle';
import { LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_BLURBS } from '@/lib/lifecycle';
import { computeInstitutionalPosture } from '@/lib/strategy/posture';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { capturePostureSnapshot, getPostureTrend } from '@/lib/queries/strategy-posture';
import { StrategyView } from './StrategyView';
import { StrategyHero } from './StrategyHero';
import { PostureScorecard } from './PostureScorecard';
import { ComplianceLane } from './ComplianceLane';

export const metadata: Metadata = { title: 'Strategy' };

/**
 * `/strategy` — the lifecycle hero, the Institutional Posture scorecard, and the
 * 100/30/10 operating plan, composed from the strategy + dashboard loaders.
 */
export default async function StrategyPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell
        identity={await getShellIdentity()}
        title="Strategy"
        subtitle="100 / 30 / 10 operating plan"
      >
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to build your 100 / 30 / 10 operating plan and track
            objectives.
          </p>
        </Card>
      </AppShell>
    );
  }

  // Strategy objectives + the lifecycle/posture context the hero binds to. The
  // dashboard loader already derives the stage, loop progress, and readiness
  // from the tested engine — reuse it rather than recomputing here.
  const [{ objectives }, dashboard, memberProfile, complianceLane] = await Promise.all([
    getStrategyData(org.orgId),
    getDashboardData(org.orgId),
    getMemberProfile(),
    getComplianceLane(org.orgId)
  ]);

  // The stage the current one unlocks (compounding): next in the ordered loop.
  const stageIndex = LIFECYCLE_STAGES.indexOf(dashboard.stage);
  const nextStage = stageIndex >= 0 ? (LIFECYCLE_STAGES[stageIndex + 1] ?? null) : null;

  // Institutional Posture — composed from inputs already loaded above (Chain-of-
  // Trust layers, the capital readiness dimension, and the operating plan). Pure;
  // no extra query, no migration. A missing capital dimension is passed through
  // as null (unmeasured) rather than a fabricated 0 — the composite renormalizes.
  const capitalReadiness =
    dashboard.readinessBreakdown.find((d) => d.dimension === 'capital')?.score ?? null;
  const posture = computeInstitutionalPosture({
    trust: dashboard.executionScore.layers,
    capitalReadiness,
    objectives: objectives.map((o) => ({ priority: o.priority, done: o.state === 'done' })),
    // The Compliance pillar is now grounded in Adrian's standing compliance
    // tier (Phase 4) when it has objectives, falling back to the trust proxy.
    compliance: {
      total: complianceLane.objectives.length,
      done: complianceLane.objectives.filter((o) => o.state === 'done').length,
      overdue: complianceLane.objectives.filter((o) => o.escalated && o.state === 'open').length
    }
  });

  // Snapshot-backed compounding (blueprint Phase 3): the momentum Δ + streak and
  // the peer percentile live in org_posture_snapshots. Persist today's row first
  // (idempotent per day, via the upsert RPC) so even a brand-new org seeds its
  // first point, then read the trend against the same-stage / same-member-type
  // cohort. Both are best-effort and degrade to a calm zero-state — never a
  // fabricated Δ or rank. A pillar score absent from the dimension list passes
  // through as null (unmeasured), not a coerced zero.
  const pillarScore = (key: string) => posture.dimensions.find((d) => d.key === key)?.score ?? null;
  const memberType = memberProfile?.memberType ?? null;
  await capturePostureSnapshot({
    orgId: org.orgId,
    composite: posture.composite,
    compliance: pillarScore('compliance'),
    governance: pillarScore('governance'),
    execution: pillarScore('execution'),
    capital: pillarScore('capital'),
    stage: dashboard.stage,
    memberType
  });
  const postureTrend = await getPostureTrend(org.orgId, dashboard.stage, memberType);

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Strategy"
      subtitle="100 / 30 / 10 operating plan"
    >
      <div className="flex flex-col gap-[18px]">
        <StrategyHero
          stageLabel={dashboard.stageLabel}
          stageBlurb={dashboard.stageBlurb}
          stageIndex={stageIndex >= 0 ? stageIndex : 0}
          stageCount={LIFECYCLE_STAGES.length}
          loopProgress={dashboard.loopProgress}
          readinessScore={dashboard.readinessScore}
          readinessBreakdown={dashboard.readinessBreakdown}
          nextStageLabel={nextStage ? LIFECYCLE_STAGE_LABELS[nextStage] : null}
          nextStageBlurb={nextStage ? LIFECYCLE_STAGE_BLURBS[nextStage] : null}
        />
        <PostureScorecard posture={posture} trend={postureTrend} />
        <ComplianceLane lane={complianceLane} />
        <StrategyView initialObjectives={objectives} />
      </div>
    </AppShell>
  );
}
