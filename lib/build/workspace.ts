/**
 * lib/build/workspace.ts — the BUILD verb's hub model (pure).
 *
 * First wave of the verb-hub consolidation: each loop verb gets one surface
 * that owns its subsections' headline logic instead of leaving them as four
 * parked routes. This module is the deterministic core for `/build` — it
 * derives the four panel summaries (Profile / Strategy / Readiness / Trust),
 * the hub's headline record strength, and which panel is the operator's focus.
 *
 * Pure + dependency-free at the lib root (outside `lib/queries/*`): inputs are
 * numbers already on `DashboardData`, so the hub's first paint and the rail's
 * badges can never disagree. The IO composition lives in `lib/build/index.ts`.
 */

/** The Build verb's four subsections, in rail order. */
export type BuildPanelKey = 'profile' | 'strategy' | 'readiness' | 'trust';

export const BUILD_PANEL_KEYS: readonly BuildPanelKey[] = [
  'profile',
  'strategy',
  'readiness',
  'trust'
] as const;

/** Badge tone, matching the rail's record-strength thresholds. */
export type BuildPanelTone = 'success' | 'azure' | 'warning';

/** One subsection's summary card on the Build hub. */
export interface BuildPanel {
  key: BuildPanelKey;
  label: string;
  /** Deep link into the full subsection surface (the old route, kept live). */
  href: string;
  /** 0–100 headline score for the panel. */
  score: number;
  /** What the score measures, e.g. "Completeness". */
  metricLabel: string;
  tone: BuildPanelTone;
  /** One-line "why this matters" hint. */
  hint: string;
  /** Open gaps a counterparty would press on (profile only, today). */
  gaps: string[];
}

export interface BuildPanelInputs {
  /** Fund-profile completeness, 0–100. */
  profileCompleteness: number;
  /** Profile gap labels (fields a counterparty would press on). */
  profileGaps: string[];
  /** 0–100 progress through the seven-stage loop (strategy's stage read). */
  loopProgress: number;
  /** 0–100 institutional-readiness score. */
  readinessScore: number;
  /** Capital locked behind the readiness gap (dollars). */
  lockedByReadiness: number;
  /** 0–100 Chain-of-Trust execution score. */
  executionScore: number;
}

/** Clamp to a 0–100 integer; non-finite/negative inputs read as 0. */
function clampScore(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/** Same thresholds the rail badges use, so the hub and rail agree. */
export function panelTone(score: number): BuildPanelTone {
  if (score >= 70) return 'success';
  if (score >= 40) return 'azure';
  return 'warning';
}

/** Derive the four panel summaries from dashboard-level inputs. */
export function deriveBuildPanels(inputs: BuildPanelInputs): BuildPanel[] {
  const profile = clampScore(inputs.profileCompleteness);
  const strategy = clampScore(inputs.loopProgress);
  const readiness = clampScore(inputs.readinessScore);
  const trust = clampScore(inputs.executionScore);

  return [
    {
      key: 'profile',
      label: 'Profile',
      href: '/profile',
      score: profile,
      metricLabel: 'Completeness',
      tone: panelTone(profile),
      hint: 'Your canonical record — the Source of Truth counterparties read from.',
      gaps: inputs.profileGaps.slice(0, 3)
    },
    {
      key: 'strategy',
      label: 'Strategy',
      href: '/strategy',
      score: strategy,
      metricLabel: 'Loop progress',
      tone: panelTone(strategy),
      hint: 'Structure · story · narrative — the 100/30/10 operating plan.',
      gaps: []
    },
    {
      key: 'readiness',
      label: 'Readiness',
      href: '/readiness',
      score: readiness,
      metricLabel: 'Readiness score',
      tone: panelTone(readiness),
      hint:
        inputs.lockedByReadiness > 0
          ? 'How investable you are today — capital is locked behind the gap.'
          : 'How investable you are, today.',
      gaps: []
    },
    {
      key: 'trust',
      label: 'Chain of Trust',
      href: '/trust',
      score: trust,
      metricLabel: 'Execution score',
      tone: panelTone(trust),
      hint: 'Proof, layer by layer — what your closes feed back into.',
      gaps: []
    }
  ];
}

/**
 * The hub's headline: mean of the four panel scores. One number for "how
 * strong is the record", mirroring how the chain record averages its layers.
 */
export function buildRecordStrength(panels: readonly BuildPanel[]): number {
  if (panels.length === 0) return 0;
  return Math.round(panels.reduce((sum, p) => sum + p.score, 0) / panels.length);
}

/**
 * The operator's focus panel: the weakest score, ties broken by rail order
 * (profile first — upstream of everything else). Strengthening the weakest
 * link moves the compound record fastest.
 */
export function rankBuildFocus(panels: readonly BuildPanel[]): BuildPanel | null {
  let focus: BuildPanel | null = null;
  for (const panel of panels) {
    if (!focus || panel.score < focus.score) focus = panel;
  }
  return focus;
}
