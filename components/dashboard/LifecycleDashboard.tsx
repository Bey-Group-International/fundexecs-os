import { ScrollText } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import type { MemberType } from '@/lib/member-types';
import type { LifecycleStage } from '@/lib/lifecycle';
import type { DashboardData } from '@/lib/queries/dashboard';
import { cn } from '@/lib/utils';
import { LifecycleStageRail } from './LifecycleStageRail';
import { ReadinessGauge } from './ReadinessGauge';
import { MajorAlertsCard } from './MajorAlertsCard';
import { ExecutionScoreCard } from './ExecutionScoreCard';
import { NextBestActionCard } from './NextBestActionCard';
import { DailyCommandList } from './DailyCommandList';
import { ActivityFeedCard } from './ActivityFeedCard';
import { StageKpiGrid } from './StageKpiGrid';
import { RaiseProgressBar } from './RaiseProgressBar';
import { SinceAwayBanner } from './SinceAwayBanner';
import { EarnBriefingCard } from './EarnBriefingCard';
import { AgentTeamStrip } from './AgentTeamStrip';
import { MomentumCard } from './MomentumCard';
import { MarkVisited } from './MarkVisited';

/* ============================================================================
 * LifecycleDashboard — the single, lifecycle-aware Dashboard canvas.
 *
 * Replaces the prior five stacked per-member-type layouts. Variant logic is
 * internal: the `memberType` prop selects copy + section ordering through
 * `MEMBER_TYPE_VARIANTS`; the underlying data shape is the same `DashboardData`
 * for every operator.
 *
 * Section ordering (compounding command center):
 *   0. Continuity — SinceAwayBanner ("since you were away") + MarkVisited
 *   1. Hero       — greeting · LifecycleStageRail (7-step + loopProgress)
 *   2. Briefing   — Earn's synthesized daily briefing (COO voice)
 *   3. Spotlight  — NextBestAction · ExecutionScore · ReadinessGauge
 *   4. Momentum   — committed-capital sparkline (hidden until there's data)
 *   5. Team       — AgentTeamStrip (15-strong desk, stage-aware)
 *   6. Operate    — MajorAlerts · DailyCommand · StageKpiGrid · RaiseProgress
 *   7. Audit      — ActivityFeed
 *
 * Solid `bg-bg-1` everywhere. No inline hex. Tokens-only. Cards rise in via the
 * shared `.fx-rise` (reduced-motion-guarded in globals.css).
 * ========================================================================= */

export interface MemberTypeVariant {
  /** Hero greeting eyebrow ("CHIEF OPERATING OFFICER · YOUR LIVE AI GUIDE"). */
  eyebrow: string;
  /** Verb that precedes the manager's name in the hero greeting. */
  greeting: (firstName: string) => string;
  /** One-line summary of the operator's persona, shown under the greeting. */
  summary: string;
  /** Order of the four "operate row" sub-sections. Lets a startup operator
   *  see Raise Progress before Daily Command, while a service-provider sees
   *  Daily Command first, etc. The dashboard composer renders this. */
  operateOrder: readonly ('alerts' | 'daily' | 'stage' | 'raise')[];
}

export const MEMBER_TYPE_VARIANTS: Record<MemberType | 'default', MemberTypeVariant> = {
  investment_firm: {
    eyebrow: 'Chief Operating Officer · your live AI guide',
    greeting: (n) => `Today's plan, ${n}.`,
    summary:
      'Run the desk like a far larger institution — every move on the record, audit-ready, documented as it forms.',
    operateOrder: ['stage', 'raise', 'alerts', 'daily']
  },
  individual_investor: {
    eyebrow: 'Chief Operating Officer · your live AI guide',
    greeting: (n) => `Good to see you, ${n}.`,
    summary:
      'Your private allocator desk — Earn keeps the watchlist warm, the diligence clean, and the conviction sharp.',
    operateOrder: ['stage', 'alerts', 'daily', 'raise']
  },
  service_provider: {
    eyebrow: 'Chief Operating Officer · your live AI guide',
    greeting: (n) => `Welcome back, ${n}.`,
    summary:
      'Inbound, ideal-client matches, and demand signal — Earn keeps the practice on the record.',
    operateOrder: ['daily', 'stage', 'alerts', 'raise']
  },
  startup: {
    eyebrow: 'Chief Operating Officer · your live AI guide',
    greeting: (n) => `Hey ${n} — let's get the raise closed.`,
    summary:
      'Raise materials, warm intros, investor targets — Earn keeps every conversation audit-ready.',
    operateOrder: ['raise', 'daily', 'stage', 'alerts']
  },
  student: {
    eyebrow: 'Chief Operating Officer · your live AI guide',
    greeting: (n) => `Welcome, ${n}.`,
    summary:
      "Your student-led-fund desk — Earn shapes the loop while you build the institution's instincts.",
    operateOrder: ['daily', 'stage', 'alerts', 'raise']
  },
  default: {
    eyebrow: 'Chief Operating Officer · your live AI guide',
    greeting: (n) => `Good to see you, ${n}.`,
    summary:
      'Your private-markets command center — Earn coordinates the team and your Chain of Trust holds the proof.',
    operateOrder: ['stage', 'alerts', 'daily', 'raise']
  }
};

export interface LifecycleDashboardProps {
  /** Display name used in the hero greeting. */
  displayName: string;
  /** Resolved member type (or null when onboarding is in progress). */
  memberType: MemberType | null;
  /** Lifecycle-aware payload from `getDashboardData(orgId)`. */
  data: DashboardData;
}

export function LifecycleDashboard({ displayName, memberType, data }: LifecycleDashboardProps) {
  const variant = MEMBER_TYPE_VARIANTS[memberType ?? 'default'];
  const firstName = displayName.split(' ')[0] || displayName || 'there';
  const currentStage: LifecycleStage = data.stage;

  return (
    <div
      className="flex flex-col gap-[14px]"
      data-testid="lifecycle-dashboard"
      data-member-type={memberType ?? 'unknown'}
      data-stage={currentStage}
    >
      {/* 0) Continuity — record this visit + summarize what changed */}
      <MarkVisited />
      <SinceAwayBanner since={data.sinceLastVisit} />

      {/* 1) Hero — greeting + lifecycle rail */}
      <Card className="fx-rise relative overflow-hidden p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 130% at 0% 0%, rgba(91,141,239,0.08), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(247,201,72,0.05), transparent 65%)'
          }}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
              Earnest Fundmaker · {variant.eyebrow}
            </p>
            <h1
              data-testid="lifecycle-dashboard-greeting"
              className="mt-1 text-[22px] font-semibold tracking-[-0.018em] text-fg-1 sm:text-[24px]"
            >
              {variant.greeting(firstName)}
            </h1>
            <p className="mt-0.5 max-w-[64ch] text-[12.5px] text-fg-3">{variant.summary}</p>
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-azure-1">
              <ScrollText size={11} strokeWidth={2} aria-hidden />
              {data.fundProfile.fundName} · {data.fundProfile.completenessScore}% on the record
            </p>
          </div>
        </div>
      </Card>

      <LifecycleStageRail
        stage={data.stage}
        stageBlurb={data.stageBlurb}
        loopProgress={data.loopProgress}
      />

      {/* 2) Briefing — Earn's synthesized daily read */}
      <EarnBriefingCard briefing={data.briefing} />

      {/* 3) Spotlight — Next Best · Execution · Readiness */}
      <div className="grid gap-[14px] lg:grid-cols-[1.3fr_1fr_1fr]">
        <NextBestActionCard action={data.nextBestAction} />
        <ExecutionScoreCard execution={data.executionScore} />
        <ReadinessGauge score={data.readinessScore} breakdown={data.readinessBreakdown} />
      </div>

      {/* 4) Momentum — committed-capital trend (self-hides until there's data) */}
      <MomentumCard momentum={data.momentum} />

      {/* 5) Team — the 15-strong desk, working the current stage */}
      <AgentTeamStrip team={data.agentTeam} />

      {/* 6) Operate — order per member-type variant */}
      <div className={cn('grid gap-[14px]', operateGridClass(variant.operateOrder.length))}>
        {variant.operateOrder.map((slot) => {
          if (slot === 'alerts') return <MajorAlertsCard key="alerts" alerts={data.majorAlerts} />;
          if (slot === 'daily') return <DailyCommandList key="daily" actions={data.dailyCommand} />;
          if (slot === 'stage')
            return <StageKpiGrid key="stage" stage={data.stage} kpis={data.stageKpis} />;
          if (slot === 'raise')
            return <RaiseProgressBar key="raise" progress={data.raiseProgress} />;
          return null;
        })}
      </div>

      {/* 7) Audit feed — bottom */}
      <ActivityFeedCard items={data.activityFeed} />
    </div>
  );
}

/** Compose a responsive grid that flows the four operate sections one or two
 *  per row across breakpoints. */
function operateGridClass(count: number): string {
  if (count <= 2) return 'sm:grid-cols-2';
  return 'sm:grid-cols-2 lg:grid-cols-2';
}

export default LifecycleDashboard;
