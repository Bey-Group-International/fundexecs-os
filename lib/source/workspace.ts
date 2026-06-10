import {
  moneyMetric,
  rankStakeFocus,
  scoreMetric,
  scoreTone,
  type HubHeadline,
  type HubPanel
} from '@/lib/loop-hub';

/**
 * lib/source/workspace.ts — the SOURCE verb's hub model (pure).
 *
 * Source finds the deals and capital that fit. Its three panels mirror the
 * rail cluster: Deals (top-of-funnel screening, in dollars sourced), LPs (the
 * raise gap — what's still to find), and Capital (raise coverage, as a 0–100
 * score so soft-circles count toward the picture). The headline is the
 * capital the verb has put in motion.
 *
 * Pure: inputs are numbers already on `DashboardData`. IO in `./index.ts`.
 */

/** The slice of a value-at-stake signal the panels need. */
export interface SourceStake {
  amount: number;
  count: number;
  staleCount: number;
  tone: 'azure' | 'warning' | 'danger';
}

export interface SourceWorkspaceInputs {
  /** Open deals being sourced/screened (pre-diligence). */
  deals: SourceStake;
  /** Gap to target — what's still to raise. */
  raiseGap: SourceStake;
  /** Raise rollup. */
  raise: { target: number; committed: number; softCircled: number; coveragePct: number };
}

/** Derive the three Source panels, in rail order. */
export function deriveSourcePanels(inputs: SourceWorkspaceInputs): HubPanel[] {
  const coverage = inputs.raise.coveragePct;
  return [
    {
      key: 'deals',
      label: 'Deals',
      href: '/deal-desk?view=sourcing',
      metric: moneyMetric('Sourced & in motion', inputs.deals.amount, inputs.deals.count),
      tone: inputs.deals.tone,
      hint:
        inputs.deals.staleCount > 0
          ? `Screen incoming deal flow — ${inputs.deals.staleCount} gone quiet.`
          : 'Screen incoming deal flow before it goes stale.'
    },
    {
      key: 'lps',
      label: 'LPs',
      href: '/pipeline',
      metric: moneyMetric('Still to raise', inputs.raiseGap.amount, inputs.raiseGap.count),
      tone: inputs.raiseGap.tone,
      hint: 'LP universe + pipeline — the gap to target lives here.'
    },
    {
      key: 'capital',
      label: 'Capital',
      href: '/capital-stack',
      metric: scoreMetric('Raise coverage', coverage),
      tone: scoreTone(coverage),
      hint: 'Search & shape the raise — committed + soft-circled vs target.'
    }
  ];
}

/** The hub headline: capital the verb has put in motion (sourced + soft). */
export function sourceHeadline(inputs: SourceWorkspaceInputs): HubHeadline {
  return {
    label: 'Capital in motion',
    metric: moneyMetric(
      'Sourced + soft-circled',
      inputs.deals.amount + inputs.raise.softCircled,
      inputs.deals.count
    )
  };
}

/**
 * Focus: staleness first (the shared stake rule), else the LP gap while one
 * exists — Source's standing job is closing the distance to target.
 */
export function rankSourceFocus(
  panels: readonly HubPanel[],
  inputs: SourceWorkspaceInputs
): string | null {
  const stale = rankStakeFocus(panels);
  if (stale) return stale;
  if (inputs.raiseGap.amount > 0) return 'lps';
  return null;
}
