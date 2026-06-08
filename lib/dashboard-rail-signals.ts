import type { DashboardData } from '@/lib/queries/dashboard';
import type { NavSignals } from '@/components/shell/Wave1SideRail';
import type { MemberType } from '@/lib/member-types';
import { lifecycleStageIndex, LIFECYCLE_STAGES } from '@/lib/lifecycle';

/**
 * The capital metric reads differently by operator type: GPs *raise* capital,
 * LPs *allocate* it, and service providers *aggregate* it across the clients
 * they serve. Everyone else (startups raising, student-led funds) reads as a
 * raise. Drives the side-rail coverage badge's label.
 */
function capitalNounFor(memberType: MemberType | null | undefined): string {
  switch (memberType) {
    case 'individual_investor':
      return 'allocated';
    case 'service_provider':
      return 'aggregated';
    case 'investment_firm':
    case 'startup':
    case 'student':
    default:
      return 'raised';
  }
}

/**
 * Derive the side-rail's live-signal payload from `getDashboardData`'s output.
 *
 * Kept as a tiny pure helper at the lib root (outside `lib/queries/*` which
 * the Wave-1 UI lane is forbidden from editing). Every rail badge maps to a
 * single dashboard field — when no signal makes sense for a route we simply
 * omit it (the rail renders that link without a badge). Color tones nudge
 * the operator toward action: warning for things needing attention, success
 * for clean state, azure for informational counts, gold for the lifecycle
 * end-state (`/audit`).
 */
export function buildRailSignals(data: DashboardData, memberType?: MemberType | null): NavSignals {
  const badges: NonNullable<NavSignals['badges']> = {};
  const capitalNoun = capitalNounFor(memberType);

  // Source of Truth · Fund Profile — completeness %
  badges['/profile'] = {
    value: `${data.fundProfile.completenessScore}%`,
    tone: data.fundProfile.completenessScore >= 70 ? 'success' : 'azure',
    hint: 'Profile completeness — Source of Truth'
  };

  // Daily Execution · Dashboard — major alerts count
  if (data.majorAlerts.length > 0) {
    badges['/command-center'] = {
      value: data.majorAlerts.length,
      tone: 'warning',
      hint: `${data.majorAlerts.length} alert${data.majorAlerts.length === 1 ? '' : 's'} needing attention`
    };
  }

  // Daily Execution · Action Queue — daily command count
  if (data.dailyCommand.length > 0) {
    badges['/action-queue'] = {
      value: data.dailyCommand.length,
      tone: 'azure',
      hint: 'Items in today’s prioritized queue'
    };
  }

  // Capital Formation · Pipeline — coverage % if a target exists. The label is
  // operator-aware: capital raised (GPs) / allocated (LPs) / aggregated
  // (service providers).
  if (data.raiseProgress.target > 0) {
    badges['/pipeline'] = {
      value: `${data.raiseProgress.coveragePct}%`,
      tone: data.raiseProgress.coveragePct >= 100 ? 'success' : 'azure',
      hint: `Coverage toward capital ${capitalNoun}`
    };
  }

  // Audit · Memory Audit Trail — count of recent recorded activity.
  if (data.activityFeed.length > 0) {
    badges['/audit'] = {
      value: data.activityFeed.length,
      tone: 'gold',
      hint: 'Recent actions on the record'
    };
  }

  // Source of Truth · Trust Center — execution score posture.
  badges['/trust'] = {
    value: `${data.executionScore.score}`,
    tone: data.executionScore.score >= 60 ? 'success' : 'azure',
    hint: 'Chain-of-Trust execution score'
  };

  return {
    currentStage: data.stage,
    badges,
    // The condensed operating spine — readiness/loop meter + next-best-action.
    // Same engine output as the Command Center hero, surfaced on the rail.
    momentum: {
      loopProgress: data.loopProgress,
      readinessScore: data.readinessScore,
      stageLabel: data.stageLabel,
      stageIndex: lifecycleStageIndex(data.stage),
      stageCount: LIFECYCLE_STAGES.length,
      nextBestAction: data.nextBestAction
        ? {
            title: data.nextBestAction.title,
            cta: data.nextBestAction.cta,
            href: data.nextBestAction.href
          }
        : undefined
    }
  };
}
