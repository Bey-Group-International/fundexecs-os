/**
 * lib/loop-hub.ts — the verb hubs' shared vocabulary (pure).
 *
 * Wave 2 of the verb-hub consolidation: all four hubs (/build /source /run
 * /drive) render through one presentational component, so the panel/headline
 * shapes live here — one spelling for every verb. Two metric kinds cover the
 * loop: record-strength surfaces read as 0–100 *scores*; deal/capital surfaces
 * read in *dollars* (mirroring the rail's value-at-stake badges).
 *
 * Pure + dependency-free at the lib root: no loaders, no React, no icons.
 * Per-verb derivations live in `lib/<verb>/workspace.ts`; IO composition in
 * `lib/loop-hub.server.ts` and `lib/<verb>/index.ts`.
 */

/** Badge tone, matching the rail's thresholds + stake tones. */
export type HubTone = 'success' | 'azure' | 'warning' | 'danger' | 'neutral';

/** A panel's (or headline's) measurable value. */
export type HubMetric =
  | { kind: 'score'; label: string; value: number }
  | { kind: 'money'; label: string; amount: number; count: number };

/** One subsection card on a verb hub. */
export interface HubPanel {
  key: string;
  label: string;
  /** Deep link into the full subsection surface. */
  href?: string;
  /** Clicking opens the Earn dock seeded with this prompt (AI action). */
  earnPrompt?: string;
  /** Null renders a calm "soon" affordance (unbuilt surface). */
  metric: HubMetric | null;
  tone: HubTone;
  /** One-line "why this matters" hint. */
  hint: string;
  /** Open gaps a counterparty would press on (record surfaces only). */
  gaps?: string[];
}

/** The hub hero's headline number. */
export interface HubHeadline {
  label: string;
  metric: HubMetric;
}

/** Clamp to a 0–100 integer; non-finite/negative inputs read as 0. */
export function clampScore(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/** Same thresholds the rail badges use, so hubs and rail always agree. */
export function scoreTone(score: number): HubTone {
  if (score >= 70) return 'success';
  if (score >= 40) return 'azure';
  return 'warning';
}

/** A 0–100 score metric, clamped. */
export function scoreMetric(label: string, value: number): HubMetric {
  return { kind: 'score', label, value: clampScore(value) };
}

/** A dollars metric; negative/non-finite inputs read as 0. */
export function moneyMetric(label: string, amount: number, count = 0): HubMetric {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return { kind: 'money', label, amount: safe(amount), count: Math.round(safe(count)) };
}

/**
 * The shared focus rule for stake-driven verbs: the first panel that's gone
 * stale (danger, then warning) needs the operator first; ties break by panel
 * order. Returns the panel key, or null when nothing is at risk.
 */
export function rankStakeFocus(panels: readonly HubPanel[]): string | null {
  for (const tone of ['danger', 'warning'] as const) {
    const hit = panels.find((p) => p.tone === tone);
    if (hit) return hit.key;
  }
  return null;
}
