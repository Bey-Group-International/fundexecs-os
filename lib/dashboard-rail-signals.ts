import type { DashboardData } from '@/lib/queries/dashboard';
import type { NavSignals, RailSignal } from '@/components/shell/Wave1SideRail';
import type { MemberType } from '@/lib/member-types';
import type { StakeSignal } from '@/lib/queries/dashboard/value-at-stake';
import { lifecycleStageIndex, LIFECYCLE_STAGES } from '@/lib/lifecycle';
import { compactMoney } from '@/lib/format';
import { buildLoopChain } from '@/lib/loop-chain';

/**
 * The capital metric reads differently by operator type: GPs *raise* capital,
 * LPs *allocate* it, and service providers *aggregate* it across the clients
 * they serve. Everyone else (startups raising, student-led funds) reads as a
 * raise. Drives the raise-gap badge's wording.
 */
function capitalVerbFor(memberType: MemberType | null | undefined): string {
  switch (memberType) {
    case 'individual_investor':
      return 'allocate';
    case 'service_provider':
      return 'aggregate';
    case 'investment_firm':
    case 'startup':
    case 'student':
    default:
      return 'raise';
  }
}

/** Pluralize "deal" / "item" for tooltips. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Append a "· N stale" clause when a surface has gone quiet. */
function staleClause(s: StakeSignal): string {
  return s.staleCount > 0 ? ` · ${s.staleCount} stale` : '';
}

/**
 * A value-at-stake badge: the $ figure displayed, with `amount` carried raw so
 * the cluster rollup can sum dollars (not parse the formatted string). Returns
 * undefined when there's nothing at stake, so the route renders bare.
 */
function stakeBadge(s: StakeSignal, hint: string): RailSignal | undefined {
  if (s.amount <= 0) return undefined;
  return { value: compactMoney(s.amount), tone: s.tone, hint, amount: s.amount };
}

/**
 * Derive the side-rail's live-signal payload from `getDashboardData`'s output.
 *
 * Phase 3: the per-verb badges carry **value at stake** — the capital exposed
 * and unclosed on each surface (the $ figure), toned by **staleness** (azure →
 * warning → danger), with the item **count** in the tooltip. Record-strength
 * surfaces (Profile / Readiness / Trust) keep their scores; only the deal and
 * capital verbs read in dollars. `amount` on a badge means "counts toward the
 * cluster's $-at-risk rollup"; display-only badges omit it.
 *
 * Pure helper at the lib root (outside `lib/queries/*`, which the Wave-1 UI lane
 * can't edit). When no signal makes sense for a route, it's simply omitted.
 */
export function buildRailSignals(data: DashboardData, memberType?: MemberType | null): NavSignals {
  const badges: NonNullable<NavSignals['badges']> = {};
  const v = data.valueAtStake;
  const capitalVerb = capitalVerbFor(memberType);

  /* -- Build: record-strength scores (display-only) + locked-capital rollup -- */

  // Profile — completeness %, the Source of Truth.
  badges['/profile'] = {
    value: `${data.fundProfile.completenessScore}%`,
    tone: data.fundProfile.completenessScore >= 70 ? 'success' : 'azure',
    hint: 'Profile completeness — your Source of Truth'
  };

  // Readiness — the score is shown; the cluster rollup reads the capital locked
  // behind it (target × readiness-gap), so Build's headline is "$ you can't yet
  // credibly raise."
  badges['/readiness'] = {
    value: `${data.readinessScore}`,
    tone: data.readinessScore >= 70 ? 'success' : data.readinessScore >= 40 ? 'azure' : 'warning',
    hint:
      v.lockedByReadiness > 0
        ? `Readiness ${data.readinessScore}/100 · ${compactMoney(v.lockedByReadiness)} locked behind it`
        : `Readiness ${data.readinessScore}/100`,
    amount: v.lockedByReadiness > 0 ? v.lockedByReadiness : undefined
  };

  // Chain of Trust — execution score posture.
  badges['/trust'] = {
    value: `${data.executionScore.score}`,
    tone: data.executionScore.score >= 60 ? 'success' : 'azure',
    hint: 'Chain-of-Trust execution score'
  };

  /* -- Source: deals in motion + the raise gap ------------------------------ */

  const dealsBadge = stakeBadge(
    v.deals,
    `${compactMoney(v.deals.amount)} sourced · ${plural(v.deals.count, 'deal')} in motion${staleClause(v.deals)}`
  );
  if (dealsBadge) badges['/deal-desk?view=sourcing'] = dealsBadge;

  // LPs / Capital — the gap to target (what's still to raise/allocate/aggregate).
  const gapBadge = stakeBadge(
    v.raiseGap,
    `${compactMoney(v.raiseGap.amount)} still to ${capitalVerb} — gap to target`
  );
  if (gapBadge) badges['/pipeline'] = gapBadge;

  /* -- Run: capital awaiting a diligence decision --------------------------- */

  const diligenceBadge = stakeBadge(
    v.diligence,
    `${compactMoney(v.diligence.amount)} awaiting a decision · ${plural(v.diligence.count, 'deal')} in diligence${staleClause(v.diligence)}`
  );
  if (diligenceBadge) badges['/ic-memos'] = diligenceBadge;

  /* -- Drive: capital near close + committed -------------------------------- */

  const nearCloseBadge = stakeBadge(
    v.nearClose,
    `${compactMoney(v.nearClose.amount)} near close · ${plural(v.nearClose.count, 'deal')}${staleClause(v.nearClose)}`
  );
  if (nearCloseBadge) badges['/deal-desk'] = nearCloseBadge;

  // Cap Table — committed capital. Display-only (it's realized, not at risk), so
  // no `amount`: it shows the figure without inflating the Drive at-risk rollup.
  if (v.committed.amount > 0) {
    badges['/cap-table'] = {
      value: compactMoney(v.committed.amount),
      tone: 'azure',
      hint: `${compactMoney(v.committed.amount)} committed`
    };
  }

  /* -- Pinned Command Center — alerts needing attention --------------------- */

  if (data.majorAlerts.length > 0) {
    badges['/command-center'] = {
      value: data.majorAlerts.length,
      tone: 'warning',
      hint: `${plural(data.majorAlerts.length, 'alert')} needing attention`
    };
  }

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
        : undefined,
      // Phase 4: the loop as a chain — each link charges the next. Gate
      // clearance sets link state; today's check-offs fill the active charge.
      chain: buildLoopChain({
        stage: data.stage,
        dailyDone: data.executionScore.dailyDone,
        dailyTotal: data.executionScore.dailyTotal,
        committed: data.raiseProgress.committed,
        readinessScore: data.readinessScore
      })
    }
  };
}
