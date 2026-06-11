/**
 * lib/dashboard/cockpit.ts — the Command Center "cockpit" model (pure).
 *
 * The onboarding prototype's daily home leads with a lifecycle cockpit: the
 * four loop verbs (Build · Source · Run · Drive) as a tappable grid, each with
 * a readiness %, the current stage's verb marked "NOW". This derives that grid
 * from the real `DashboardData` so the cockpit and the side rail read from the
 * same truth — no mock data.
 *
 * Kept pure (no React, no lucide, no IO) so it unit-tests without a DOM and is
 * safe to import from server components.
 */
import type { LifecycleStage } from '@/lib/lifecycle';
import type { ReadinessDimensionScore } from '@/lib/lifecycle';

/** The four loop verbs — mirrors the rail's `RailGroupKey`. */
export type HubKey = 'build' | 'source' | 'run' | 'drive';

export interface HubMeta {
  key: HubKey;
  label: string;
  href: string;
}

/** Static hub metadata — labels + canonical hub routes (match the rail). */
export const COCKPIT_HUBS: readonly HubMeta[] = [
  { key: 'build', label: 'Build', href: '/build' },
  { key: 'source', label: 'Source', href: '/source' },
  { key: 'run', label: 'Run', href: '/run' },
  { key: 'drive', label: 'Drive', href: '/drive' }
] as const;

/**
 * Which verb each lifecycle stage primarily emphasizes. A pure, lucide-free
 * twin of the rail's `STAGE_TO_GROUP_KEYS` (kept local so this module stays
 * importable from server + tests without pulling icon components).
 */
const STAGE_PRIMARY_HUB: Record<LifecycleStage, HubKey> = {
  establish_truth: 'build',
  get_raise_ready: 'build',
  source_lps: 'source',
  convert_lps: 'source',
  source_deals: 'source',
  operate: 'run',
  prove: 'drive'
};

export interface CockpitHub extends HubMeta {
  /** 0–100 readiness for this verb, derived from the readiness breakdown. */
  pct: number;
  /** True when the current lifecycle stage emphasizes this verb (the "NOW"). */
  isCurrent: boolean;
}

function dimScore(breakdown: ReadinessDimensionScore[], dimension: string): number {
  const hit = breakdown.find((d) => d.dimension === dimension);
  return hit ? Math.max(0, Math.min(100, Math.round(hit.score))) : 0;
}

/**
 * Derive the four-verb cockpit from the dashboard's readiness breakdown +
 * current stage. The verb→dimension grouping mirrors what each hub owns:
 *   Build  = profile + proof   (the record you build)
 *   Source = pipeline          (deals + capital you source)
 *   Run    = materials         (diligence / the work)
 *   Drive  = capital           (close it out)
 */
export function deriveCockpit(input: {
  readinessBreakdown: ReadinessDimensionScore[];
  stage: LifecycleStage;
}): CockpitHub[] {
  const b = input.readinessBreakdown;
  const build = Math.round((dimScore(b, 'profile') + dimScore(b, 'proof')) / 2);
  const pct: Record<HubKey, number> = {
    build,
    source: dimScore(b, 'pipeline'),
    run: dimScore(b, 'materials'),
    drive: dimScore(b, 'capital')
  };
  const current = STAGE_PRIMARY_HUB[input.stage];
  return COCKPIT_HUBS.map((h) => ({
    ...h,
    pct: pct[h.key],
    isCurrent: h.key === current
  }));
}
