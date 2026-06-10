import {
  clampScore,
  moneyMetric,
  rankStakeFocus,
  scoreMetric,
  scoreTone,
  type HubHeadline,
  type HubPanel
} from '@/lib/loop-hub';

/**
 * lib/drive/workspace.ts — the DRIVE verb's hub model (pure).
 *
 * Drive takes the deal to close. Its panels mirror the rail cluster:
 * Materials (the readiness dimension that gates a credible close, 0–100),
 * Deal Desk (capital near close — committed but not closed, in dollars),
 * Cap Table (realized committed capital — display-only, never "at risk"),
 * and Execute (pre-acquisition → exit, not yet built). The headline is
 * close progress: committed vs target — Drive's scoreboard. A close here
 * compounds back into Build via recordLoopClose.
 *
 * Pure: inputs are numbers already on `DashboardData`. IO in `./index.ts`.
 */

export interface DriveStake {
  amount: number;
  count: number;
  staleCount: number;
  tone: 'azure' | 'warning' | 'danger';
}

export interface DriveWorkspaceInputs {
  /** Committed-but-not-closed capital (at risk of slipping). */
  nearClose: DriveStake;
  /** Realized committed capital. */
  committed: DriveStake;
  /** The 'materials' readiness dimension score, 0–100. */
  materialsScore: number;
  /** committed / target, 0–100 (0 when no target). */
  committedPct: number;
}

/** Derive the four Drive panels, in rail order. */
export function deriveDrivePanels(inputs: DriveWorkspaceInputs): HubPanel[] {
  const materials = clampScore(inputs.materialsScore);
  return [
    {
      key: 'materials',
      label: 'Materials Studio',
      href: '/materials',
      metric: scoreMetric('Materials readiness', materials),
      tone: scoreTone(materials),
      hint: 'Decks, memos, one-pagers — generated from the live record.'
    },
    {
      key: 'deal-desk',
      label: 'Deal Desk',
      href: '/deal-desk',
      metric: moneyMetric('Near close', inputs.nearClose.amount, inputs.nearClose.count),
      tone: inputs.nearClose.tone,
      hint:
        inputs.nearClose.staleCount > 0
          ? `Work the live deal — ${inputs.nearClose.staleCount} near-close gone quiet.`
          : 'Work the live deal — signatures, steps, and the last mile.'
    },
    {
      key: 'cap-table',
      label: 'Cap Table',
      href: '/cap-table',
      metric: moneyMetric('Committed', inputs.committed.amount, inputs.committed.count),
      // Realized capital is never "at risk" — display-only azure, like the rail.
      tone: 'azure',
      hint: 'Ownership & dilution — what your closes already secured.'
    },
    {
      key: 'execute',
      label: 'Execute',
      metric: null,
      tone: 'neutral',
      hint: 'Pre-acquisition → post-acquisition → exit — coming soon.'
    }
  ];
}

/** The hub headline: close progress — committed vs target. */
export function driveHeadline(inputs: DriveWorkspaceInputs): HubHeadline {
  return {
    label: 'Close progress',
    metric: scoreMetric('Committed vs target', inputs.committedPct)
  };
}

/**
 * Focus: staleness first (a slipping near-close beats everything), else
 * Materials while the dimension is below the institutional bar — weak
 * materials stall every close behind them.
 */
export function rankDriveFocus(
  panels: readonly HubPanel[],
  inputs: DriveWorkspaceInputs
): string | null {
  const stale = rankStakeFocus(panels);
  if (stale) return stale;
  if (clampScore(inputs.materialsScore) < 70) return 'materials';
  return null;
}
