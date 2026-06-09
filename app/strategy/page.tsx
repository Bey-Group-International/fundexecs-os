import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getStrategyData } from '@/lib/queries/strategy';
import { getDashboardData } from '@/lib/queries/dashboard/lifecycle';
import { LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_BLURBS } from '@/lib/lifecycle';
import { computeInstitutionalPosture } from '@/lib/strategy/posture';
import { StrategyView } from './StrategyView';
import { StrategyHero } from './StrategyHero';
import { PostureScorecard } from './PostureScorecard';

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
  const [{ objectives }, dashboard] = await Promise.all([
    getStrategyData(org.orgId),
    getDashboardData(org.orgId)
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
    objectives: objectives.map((o) => ({ priority: o.priority, done: o.state === 'done' }))
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
          readinessScore={dashboard.readinessScore}
          readinessBreakdown={dashboard.readinessBreakdown}
          nextStageLabel={nextStage ? LIFECYCLE_STAGE_LABELS[nextStage] : null}
          nextStageBlurb={nextStage ? LIFECYCLE_STAGE_BLURBS[nextStage] : null}
        />
        <PostureScorecard posture={posture} />
        <StrategyView initialObjectives={objectives} />
      </div>
    </AppShell>
  );
}
