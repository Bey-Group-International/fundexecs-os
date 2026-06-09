import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getStrategyData } from '@/lib/queries/strategy';
import { getDashboardData } from '@/lib/queries/dashboard/lifecycle';
import { LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_BLURBS } from '@/lib/lifecycle';
import { computePosture, complianceLaneScore } from '@/lib/strategy/posture';
import { StrategyView } from './StrategyView';
import { StrategyHero } from './StrategyHero';

export const metadata: Metadata = { title: 'Strategy' };

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
  const [{ objectives, drafts }, dashboard] = await Promise.all([
    getStrategyData(org.orgId),
    getDashboardData(org.orgId)
  ]);

  // The stage the current one unlocks (compounding): next in the ordered loop.
  const stageIndex = LIFECYCLE_STAGES.indexOf(dashboard.stage);
  const nextStage = stageIndex >= 0 ? (LIFECYCLE_STAGES[stageIndex + 1] ?? null) : null;

  // Active (non-archived) objective count — surfaced in the hero's Earn strip.
  const objectiveCount = objectives.filter((o) => o.state !== 'archived').length;

  // Institutional Posture — derive the four lane inputs from data already
  // loaded: the lifecycle readiness breakdown + Chain-of-Trust execution score
  // + the live/draft compliance objective split. No extra queries.
  const dim = (k: string) =>
    dashboard.readinessBreakdown.find((d) => d.dimension === k)?.score ?? 0;
  const complianceLive = objectives.filter((o) => o.category === 'compliance');
  const posture = computePosture({
    capital: dim('capital'),
    governance: Math.round((dim('profile') + dim('materials')) / 2),
    execution: dashboard.executionScore.score,
    compliance: complianceLaneScore({
      doneLive: complianceLive.filter((o) => o.state === 'done').length,
      openLive: complianceLive.filter((o) => o.state === 'open').length,
      pendingDrafts: drafts.filter((d) => d.category === 'compliance').length
    })
  });

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
          postureScore={posture.score}
          postureLanes={posture.lanes}
          streak={dashboard.executionScore.streak}
          momentumDeltaPct={dashboard.momentum.deltaPct}
          nextStageLabel={nextStage ? LIFECYCLE_STAGE_LABELS[nextStage] : null}
          nextStageBlurb={nextStage ? LIFECYCLE_STAGE_BLURBS[nextStage] : null}
          objectiveCount={objectiveCount}
        />
        <StrategyView initialObjectives={objectives} initialDrafts={drafts} />
      </div>
    </AppShell>
  );
}
