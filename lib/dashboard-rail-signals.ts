import type { DashboardData } from '@/lib/queries/dashboard';
import type { NavSignals } from '@/components/shell/Wave1SideRail';

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
export function buildRailSignals(data: DashboardData): NavSignals {
  const badges: NonNullable<NavSignals['badges']> = {};

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

  // Capital Formation · LP Pipeline — coverage % if a target exists,
  // otherwise the soft-circled+committed dollar coverage isn't meaningful.
  if (data.raiseProgress.target > 0) {
    badges['/pipeline'] = {
      value: `${data.raiseProgress.coveragePct}%`,
      tone: data.raiseProgress.coveragePct >= 100 ? 'success' : 'azure',
      hint: 'Coverage toward the raise target'
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
    badges
  };
}
