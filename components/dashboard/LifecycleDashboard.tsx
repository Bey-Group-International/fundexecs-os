import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { ProfileActionButton } from '@/components/profile';
import type { MemberType } from '@/lib/member-types';
import type { LifecycleStage } from '@/lib/lifecycle';
import type { DashboardData } from '@/lib/queries/dashboard';
import type { CommandMetrics as CommandMetricsData } from '@/lib/queries/dashboard/command-metrics';
import type { TeamTaskMap } from '@/lib/queries/dashboard/team-tasks';
import type { FundProfile } from '@/lib/queries/fund-profile';
import { MajorAlertsCard } from './MajorAlertsCard';
import { ExecutionScoreCard } from './ExecutionScoreCard';
import { DailyCommandList } from './DailyCommandList';
import { LaunchBriefCard } from './LaunchBriefCard';
import { MarkVisited } from './MarkVisited';
import { DashboardShell, RevealGroup, RevealItem } from './command';
import { CommandMetrics } from './command/CommandMetrics';
import { ActivityTabs } from './command/ActivityTabs';
import { TeamTasks } from './command/TeamTasks';
import { RegenerateButton } from './command/GameBits';
import { LoopSpine } from './command/LoopSpine';
import { LifecycleCockpit } from './command/LifecycleCockpit';
import { RightNowCard } from './command/RightNowCard';
import { SignalStrip } from './command/SignalStrip';

/* ============================================================================
 * LifecycleDashboard — the Command Center, in the onboarding prototype's
 * information architecture: the loop, made legible. Unified for every member
 * type (member type only flavors the hero copy):
 *
 *   Hero + LoopSpine — slim greeting + "set the mandate → team works → approve".
 *   Cockpit          — the four loop verbs as a tappable readiness grid; the
 *                      current stage's verb marked "NOW" (mirrors the rail).
 *   Right now        — blocking alerts, then the single highest-impact move as
 *                      Earn's gold hero (prepared → you approve), with reward.
 *   Worked overnight — proactive "since you last looked" signals.
 *   Then, in order   — the ranked daily queue.
 *   The desk         — team tasks + metrics + execution score.
 *   Activity         — one tabbed feed (the only activity surface).
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

export interface LifecycleDashboardProps {
  displayName: string;
  memberType: MemberType | null;
  data: DashboardData;
  metrics: CommandMetricsData;
  /** Per-specialist real task workload (keyed by brain slug). */
  teamTasks?: TeamTaskMap;
  fundProfile: FundProfile;
  /** First use after onboarding: show Earn's dismissible launch brief on top. */
  showLaunchBrief?: boolean;
}

export function LifecycleDashboard({
  displayName,
  memberType,
  data,
  metrics,
  teamTasks,
  fundProfile,
  showLaunchBrief = false
}: LifecycleDashboardProps) {
  const copy = HERO_COPY[memberType ?? 'default'];
  const firstName = displayName.split(' ')[0] || displayName || 'there';
  const currentStage: LifecycleStage = data.stage;
  const showSignals =
    !data.sinceLastVisit.isFirstVisit && data.sinceLastVisit.highlights.length > 0;

  return (
    <DashboardShell
      notifications={{
        since: data.sinceLastVisit,
        alerts: data.majorAlerts,
        activity: data.activityFeed
      }}
    >
      <MarkVisited />

      {/* First-use welcome — Earn's launch brief, once (gated upstream). */}
      {showLaunchBrief ? (
        <div className="mb-[14px]">
          <LaunchBriefCard />
        </div>
      ) : null}

      <RevealGroup
        className="flex flex-col gap-[14px]"
        data-testid="lifecycle-dashboard"
        data-member-type={memberType ?? 'unknown'}
        data-stage={currentStage}
      >
        {/* Hero — slim greeting + Earn presence + the loop spine */}
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
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <ProfileActionButton variant="compact" profile={fundProfile} />
                  <LoopSpine />
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

        {/* Cockpit — the loop as a tappable readiness grid; mirrors the rail. */}
        <RevealItem>
          <LifecycleCockpit readinessBreakdown={data.readinessBreakdown} stage={currentStage} />
        </RevealItem>

        {/* Right now — blocking alerts, then the single highest-impact move as
            Earn's gold hero. One unmistakable action; never re-listed below. */}
        <RevealItem>
          <div className="flex flex-col gap-[14px]">
            <MajorAlertsCard alerts={data.majorAlerts} />
            <RightNowCard
              action={data.nextBestAction}
              reward={NEXT_MOVE_REWARD}
              control={<RegenerateButton />}
            />
          </div>
        </RevealItem>

        {/* Worked overnight — proactive signals since you last looked. */}
        {showSignals ? (
          <RevealItem>
            <SignalStrip since={data.sinceLastVisit} />
          </RevealItem>
        ) : null}

        {/* Then, in order — the ranked queue · the desk working + progress. */}
        <RevealItem>
          <div className="grid items-start gap-[14px] lg:grid-cols-2">
            <div className="flex flex-col gap-[14px]">
              <DailyCommandList actions={data.dailyCommand} />
            </div>
            <div className="flex flex-col gap-[14px]">
              <TeamTasks team={data.agentTeam} taskSummaries={teamTasks} />
              <CommandMetrics metrics={metrics} readinessScore={data.readinessScore} />
              <ExecutionScoreCard execution={data.executionScore} />
            </div>
          </div>
        </RevealItem>

        {/* Activity — the single tabbed feed (no duplicate recent-activity list). */}
        <RevealItem>
          <ActivityTabs items={data.activityFeed} />
        </RevealItem>
      </RevealGroup>
    </DashboardShell>
  );
}

export default LifecycleDashboard;
