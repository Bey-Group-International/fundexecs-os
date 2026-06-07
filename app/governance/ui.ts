import type { BadgeTone } from '@/components/ui';
import type { StrategyObjective } from '@/lib/queries/strategy';

/**
 * Render-agnostic display helpers for the Governance surface (100 / 30 / 10
 * objective framework). Dependency-free so the server page can import them.
 */

export type Tier = '100' | '30' | '10';

export const TIER_ORDER: Tier[] = ['100', '30', '10'];

export const TIER_COLOR: Record<Tier, string> = {
  '100': 'var(--gold-1)',
  '30': 'var(--azure-1)',
  '10': 'var(--success)'
};

export const TIER_LABEL: Record<Tier, string> = {
  '100': '100-day horizon',
  '30': '30-day horizon',
  '10': '10-day horizon'
};

export const PRIORITY_TONE: Record<StrategyObjective['priority'], BadgeTone> = {
  High: 'warning',
  Medium: 'azure',
  Low: 'neutral'
};

export const STATE_TONE: Record<StrategyObjective['state'], BadgeTone> = {
  open: 'neutral',
  done: 'success',
  archived: 'neutral'
};
