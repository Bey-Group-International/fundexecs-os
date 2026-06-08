import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { ProfileActionButton } from '@/components/profile';
import type { MemberType } from '@/lib/member-types';
import type { LifecycleStage } from '@/lib/lifecycle';
import type { DashboardData } from '@/lib/queries/dashboard';
import type { FundProfile } from '@/lib/queries/fund-profile';
import { cn } from '@/lib/utils';
import { LifecycleStageRail } from './LifecycleStageRail';
import { ReadinessGauge } from './ReadinessGauge';
import { ExecutionScoreCard } from './ExecutionScoreCard';
import { NextBestActionCard } from './NextBestActionCard';
import { DailyCommandList } from './DailyCommandList';
import { ActivityFeedCard } from './ActivityFeedCard';
import { StageKpiGrid } from './StageKpiGrid';
import { RaiseProgressBar } from './RaiseProgressBar';
import { EarnBriefingCard } from './EarnBriefingCard';
import { AgentTeamStrip } from './AgentTeamStrip';
import { MomentumCard } from './MomentumCard';
import { MarkVisited } from './MarkVisited';
import { AchievementGrid } from './AchievementGrid';
import { QuestProgressCard } from './QuestProgressCard';
import { DashboardShell, RevealGroup, RevealItem, CommandModule, RestoreTray } from './command';

/* ============================================================================
 * LifecycleDashboard — the lifecycle-aware command center (Aladdin-grade).
 *
 * Three-tier information model:
 *   SPINE (always-on)   Hero · Stage Rail · Spotlight · Operate KPIs
 *   PANELS (collapse/restore, persisted)  Briefing · Desk · Momentum ·
 *                        Achievements/Quests · Tape
 *   SIGNALS (pop-up only) Since-away · Risk Desk alerts · live tape
 *
 * Interaction layer is client (motion physics + per-operator layout state +
 * notifications); the heavy cards stay server-rendered and ride in as children.
 * Voice is FundExecs OS house — trading-desk authority with leverage framing.
 * ========================================================================= */

export interface MemberTypeVariant {
  /** Hero eyebrow ("YOUR COO · HIGHEST-LEVERAGE MOVES, ON THE RECORD"). */
  eyebrow: string;
  /** Verb-forward greeting that precedes nothing — name is appended. */
  greeting: (firstName: string) => string;
  /** One-line read on the operator's edge, shown under the greeting. */
  summary: string;
  /** Order of the four "operate row" sub-sections. */
  operateOrder: readonly ('alerts' | 'daily' | 'stage' | 'raise')[];
}

export const MEMBER_TYPE_VARIANTS: Record<MemberType | 'default', MemberTypeVariant> = {
  investment_firm: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Run lean, hit like an institution. Every move documented as it forms — your edge compounds while the record builds itself.',
    operateOrder: ['stage', 'raise', 'alerts', 'daily']
  },
  individual_investor: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Your private allocator desk. Earn keeps the watchlist warm, the diligence clean, and the conviction priced — so capital moves on proof, not vibes.',
    operateOrder: ['stage', 'alerts', 'daily', 'raise']
  },
  service_provider: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Inbound, ideal-client matches, and demand signal — the practice on the record, every relationship compounding into the next mandate.',
    operateOrder: ['daily', 'stage', 'alerts', 'raise']
  },
  startup: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `Let's close the round, ${n}.`,
    summary:
      'Materials, warm intros, investor targets — sequenced for leverage. Earn keeps every conversation audit-ready so the round closes on conviction.',
    operateOrder: ['raise', 'daily', 'stage', 'alerts']
  },
  student: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      "Your student-led-fund desk. Earn runs the loop while you build the institution's instincts — reps now, returns later.",
    operateOrder: ['daily', 'stage', 'alerts', 'raise']
  },
  default: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Your private-markets command center. Earn coordinates the desk and your Chain of Trust holds the proof — leverage in, record out.',
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
  /** Full Source-of-Truth record — powers the reactive profile button. */
  fundProfile: FundProfile;
}

export function LifecycleDashboard({
  displayName,
  memberType,
  data,
  fundProfile
}: LifecycleDashboardProps) {
  const variant = MEMBER_TYPE_VARIANTS[memberType ?? 'default'];
  const firstName = displayName.split(' ')[0] || displayName || 'there';
  const currentStage: LifecycleStage = data.stage;
  const operateSlots = variant.operateOrder.filter((slot) => slot !== 'alerts');

  return (
    <DashboardShell
      notifications={{
        since: data.sinceLastVisit,
        alerts: data.majorAlerts,
        activity: data.activityFeed
      }}
    >
      {/* Record this visit (server-driven continuity cookie). */}
      <MarkVisited />

      <RevealGroup
        className="flex flex-col gap-[14px]"
        data-testid="lifecycle-dashboard"
        data-member-type={memberType ?? 'unknown'}
        data-stage={currentStage}
      >
        {/* ---- SPINE: always-on ---- */}

        {/* Hero — greeting + Earn presence */}
        <RevealItem>
          <Card className="relative overflow-hidden p-5">
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
                <div className="mt-2.5">
                  <ProfileActionButton variant="compact" profile={fundProfile} />
                </div>
              </div>

              <div className="hidden flex-none flex-col items-center gap-1.5 sm:flex">
                <EarnCoin size={48} glow online className="flex-none" />
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-1" aria-hidden />
                  On the desk
                </span>
              </div>
            </div>
          </Card>
        </RevealItem>

        {/* Lifecycle rail */}
        <RevealItem>
          <LifecycleStageRail
            stage={data.stage}
            stageBlurb={data.stageBlurb}
            loopProgress={data.loopProgress}
          />
        </RevealItem>

        {/* Spotlight — the three live functions */}
        <RevealItem>
          <div className="grid gap-[14px] lg:grid-cols-[1.3fr_1fr_1fr]">
            <NextBestActionCard action={data.nextBestAction} />
            <ExecutionScoreCard execution={data.executionScore} />
            <ReadinessGauge score={data.readinessScore} breakdown={data.readinessBreakdown} />
          </div>
        </RevealItem>

        {/* Operate — KPIs / order book / raise, ordered per member type.
            Alerts are now pop-up signals, so they're filtered out of the row. */}
        <RevealItem>
          <div className={cn('grid gap-[14px]', operateGridClass(operateSlots.length))}>
            {operateSlots.map((slot) => {
              if (slot === 'daily')
                return <DailyCommandList key="daily" actions={data.dailyCommand} />;
              if (slot === 'stage')
                return <StageKpiGrid key="stage" stage={data.stage} kpis={data.stageKpis} />;
              if (slot === 'raise')
                return <RaiseProgressBar key="raise" progress={data.raiseProgress} />;
              return null;
            })}
          </div>
        </RevealItem>

        {/* ---- PANELS: collapse / restore (persisted) ---- */}

        <CommandModule id="briefing" label="The Morning Call · Earn's read" accent="var(--gold-1)">
          <EarnBriefingCard briefing={data.briefing} />
        </CommandModule>

        <CommandModule id="desk" label="The Executive Desk" accent="var(--azure-1)">
          <AgentTeamStrip team={data.agentTeam} activity={data.activityFeed} />
        </CommandModule>

        <CommandModule id="momentum" label="Committed Capital · Momentum" accent="var(--gold-1)">
          <MomentumCard momentum={data.momentum} />
        </CommandModule>

        <CommandModule id="progress" label="Proof & Plays" accent="var(--azure-1)">
          <div className="grid gap-[14px] lg:grid-cols-[1.4fr_1fr]">
            <AchievementGrid
              achievements={data.progress.achievements}
              placeholder={data.progress.placeholder}
            />
            <QuestProgressCard
              quests={data.progress.quests}
              placeholder={data.progress.placeholder}
            />
          </div>
        </CommandModule>

        <CommandModule id="tape" label="The Tape · on the record" accent="var(--fg-5)">
          <ActivityFeedCard items={data.activityFeed} />
        </CommandModule>

        {/* Closed-panel tray — bring any dismissed panel back. */}
        <RestoreTray />
      </RevealGroup>
    </DashboardShell>
  );
}

/** Compose a responsive grid that flows the operate sections across breakpoints. */
function operateGridClass(count: number): string {
  if (count <= 2) return 'sm:grid-cols-2';
  return 'sm:grid-cols-2 lg:grid-cols-3';
}

export default LifecycleDashboard;
