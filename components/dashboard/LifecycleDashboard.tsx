import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { ProfileActionButton } from '@/components/profile';
import type { MemberType } from '@/lib/member-types';
import type { LifecycleStage } from '@/lib/lifecycle';
import type { DashboardData } from '@/lib/queries/dashboard';
import type { CommandMetrics as CommandMetricsData } from '@/lib/queries/dashboard/command-metrics';
import type { FundProfile } from '@/lib/queries/fund-profile';
import { MajorAlertsCard } from './MajorAlertsCard';
import { ExecutionScoreCard } from './ExecutionScoreCard';
import { NextBestActionCard } from './NextBestActionCard';
import { DailyCommandList } from './DailyCommandList';
import { ActivityFeedCard } from './ActivityFeedCard';
import { MarkVisited } from './MarkVisited';
import { DashboardShell, RevealGroup, RevealItem } from './command';
import { CommandMetrics } from './command/CommandMetrics';
import { DailyBrief } from './command/DailyBrief';
import { ActivityTabs } from './command/ActivityTabs';
import { TeamTasks } from './command/TeamTasks';
import { EarnCoinIncentive, RegenerateButton } from './command/GameBits';

/* ============================================================================
 * LifecycleDashboard — the Command Center, composed in one fixed operator
 * order (unified for every member type; member type only flavors the hero
 * copy). Top-to-bottom:
 *   Hero → Action queue → Daily Brief → Execution score (gamified) →
 *   4 metric boxes → Next best action + Daily command →
 *   Activity feed (tabbed) → Team tasks → Recent activity.
 * Ambient signals (since-away, risk-desk popovers) ride in the DashboardShell.
 * ========================================================================= */

/** Earn coins credited for completing the highlighted next move. */
const NEXT_MOVE_REWARD = 25;

interface HeroCopy {
  eyebrow: string;
  greeting: (firstName: string) => string;
  summary: string;
}

const HERO_COPY: Record<MemberType | 'default', HeroCopy> = {
  investment_firm: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Run lean, hit like an institution. Every move documented as it forms — your edge compounds while the record builds itself.'
  },
  individual_investor: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Your private allocator desk. Earn keeps the watchlist warm, the diligence clean, and the conviction priced — so capital moves on proof.'
  },
  service_provider: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Inbound, ideal-client matches, and demand signal — the practice on the record, every relationship compounding into the next mandate.'
  },
  startup: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `Let's close the round, ${n}.`,
    summary:
      'Materials, warm intros, investor targets — sequenced for leverage. Earn keeps every conversation audit-ready so the round closes on conviction.'
  },
  student: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      "Your student-led-fund desk. Earn runs the loop while you build the institution's instincts — reps now, returns later."
  },
  default: {
    eyebrow: 'Your COO · highest-leverage moves, on the record',
    greeting: (n) => `The desk is open, ${n}.`,
    summary:
      'Your private-markets command center. Earn coordinates the desk and your Chain of Trust holds the proof — leverage in, record out.'
  }
};

/** A small, consistent eyebrow above each horizontal section. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-4">
      {children}
    </p>
  );
}

export interface LifecycleDashboardProps {
  displayName: string;
  memberType: MemberType | null;
  data: DashboardData;
  metrics: CommandMetricsData;
  fundProfile: FundProfile;
}

export function LifecycleDashboard({
  displayName,
  memberType,
  data,
  metrics,
  fundProfile
}: LifecycleDashboardProps) {
  const copy = HERO_COPY[memberType ?? 'default'];
  const firstName = displayName.split(' ')[0] || displayName || 'there';
  const currentStage: LifecycleStage = data.stage;

  // Daily Brief draws on today's ranked moves (dedup top-action into the loop).
  const briefActions = [
    ...(data.nextBestAction ? [data.nextBestAction] : []),
    ...data.dailyCommand
  ].filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i);

  return (
    <DashboardShell
      notifications={{
        since: data.sinceLastVisit,
        alerts: data.majorAlerts,
        activity: data.activityFeed
      }}
    >
      <MarkVisited />

      <RevealGroup
        className="flex flex-col gap-[14px]"
        data-testid="lifecycle-dashboard"
        data-member-type={memberType ?? 'unknown'}
        data-stage={currentStage}
      >
        {/* Hero — slim greeting + Earn presence */}
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
                  Earnest Fundmaker · {copy.eyebrow}
                </p>
                <h1
                  data-testid="lifecycle-dashboard-greeting"
                  className="mt-1 text-[22px] font-semibold tracking-[-0.018em] text-fg-1 sm:text-[24px]"
                >
                  {copy.greeting(firstName)}
                </h1>
                <p className="mt-0.5 max-w-[64ch] text-[12.5px] text-fg-3">{copy.summary}</p>
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

        {/* 1 · Action queue */}
        <RevealItem>
          <MajorAlertsCard alerts={data.majorAlerts} />
        </RevealItem>

        {/* 2 · Daily Brief */}
        <RevealItem>
          <DailyBrief briefing={data.briefing} actions={briefActions} alerts={data.majorAlerts} />
        </RevealItem>

        {/* 3 · Execution score — gamified, Earn-coin incentivized */}
        <RevealItem>
          <div className="flex flex-col gap-[14px]">
            <EarnCoinIncentive
              reward={NEXT_MOVE_REWARD}
              streak={data.executionScore.streak}
              nextHref={data.nextBestAction?.href ?? null}
              nextLabel={data.nextBestAction?.cta ?? 'Open the desk'}
            />
            <ExecutionScoreCard execution={data.executionScore} />
          </div>
        </RevealItem>

        {/* 4 · Four metric boxes (readiness + live counts) */}
        <RevealItem>
          <CommandMetrics metrics={metrics} readinessScore={data.readinessScore} />
        </RevealItem>

        {/* 5 · Next best action + Daily command (side by side) */}
        <RevealItem>
          <div className="grid gap-[14px] lg:grid-cols-2">
            <div className="relative">
              <div className="absolute right-4 top-4 z-10">
                <RegenerateButton />
              </div>
              <NextBestActionCard action={data.nextBestAction} />
            </div>
            <DailyCommandList actions={data.dailyCommand} />
          </div>
        </RevealItem>

        {/* 6 · Activity feed (tabbed) */}
        <RevealItem>
          <ActivityTabs items={data.activityFeed} />
        </RevealItem>

        {/* 7 · Team tasks */}
        <RevealItem>
          <TeamTasks team={data.agentTeam} />
        </RevealItem>

        {/* 8 · Recent activity */}
        <RevealItem>
          <div>
            <SectionLabel>Recent activity</SectionLabel>
            <ActivityFeedCard items={data.activityFeed.slice(0, 6)} />
          </div>
        </RevealItem>
      </RevealGroup>
    </DashboardShell>
  );
}

export default LifecycleDashboard;
