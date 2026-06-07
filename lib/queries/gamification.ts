import 'server-only';

/* ============================================================================
 * lib/queries/gamification.ts — Phase-2 SCAFFOLD (placeholder loader).
 *
 * The authoritative achievements/quests backend (`achievements`,
 * `achievements_earned`, `quests`, `quests_progress`, `xp_events`) is Phase 2
 * and DOES NOT EXIST on main yet (see memory/INTELLIGENCE_LAYER_PROPOSAL.md §4).
 *
 * This module exists so the UI (`AchievementGrid`, `QuestProgressCard`) can be
 * built and mounted NOW and light up the instant Phase 2 lands. It returns the
 * proposal's 5 launch badges + 3 launch quests as TYPED, clearly-placeholder
 * data — every achievement `earned: false`, every quest at step 0 — so the UI
 * renders an honest "not started / coming soon" state rather than faking
 * progress.
 *
 * ── LOADER CONTRACT (Phase-2 wiring is a drop-in) ──────────────────────────
 * `getAchievements(orgId)` → Promise<Achievement[]>
 *   Phase 2: SELECT from `achievements` LEFT JOIN `achievements_earned`
 *   (scoped to the org's actor) → map `earned_at` to `earned`/`earnedAt`,
 *   compute `progress` from `xp_events` where the rule is incremental.
 *
 * `getQuests(orgId)` → Promise<Quest[]>
 *   Phase 2: SELECT from `quests` LEFT JOIN `quests_progress`
 *   (scoped to the org's actor) → map `steps_completed`/`completed_at`.
 *
 * Both ALWAYS resolve (never throw): the live read is wrapped in
 * `.catch(() => <empty/placeholder>)` so a missing table or RLS denial degrades
 * to the honest placeholder rather than breaking the page. Keep the return
 * SHAPES below as the contract — Phase 2 should swap the body, not the types.
 *
 * GUARDRAIL: this file issues NO queries against non-existent tables. It is
 * pure placeholder data today.
 * ========================================================================= */

export type AchievementCategory = 'intelligence' | 'trust' | 'capital' | 'pipeline' | 'operations';
export type AchievementTone = 'info' | 'success' | 'gold';

export interface Achievement {
  /** Stable id, e.g. 'first-form-d-match'. */
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tone: AchievementTone;
  /** Whether this org has earned the badge. */
  earned: boolean;
  /** ISO earn timestamp when `earned`. */
  earnedAt: string | null;
  /** 0–100 progress for in-flight badges (null = binary / not started). */
  progress: number | null;
}

export interface QuestStep {
  /** Stable step id. */
  id: string;
  label: string;
  done: boolean;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  /** Ordered steps. */
  steps: QuestStep[];
  /** XP awarded on completion. */
  rewardXp: number;
  /** Completed-step count (mirrors `steps_completed`). */
  stepsCompleted: number;
  /** ISO completion timestamp, or null while in flight. */
  completedAt: string | null;
}

/**
 * The proposal's 5 launch badges (INTELLIGENCE_LAYER_PROPOSAL.md §6), as
 * placeholder/locked rows. Phase 2 replaces the source with the live tables.
 */
const LAUNCH_ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-form-d-match',
    title: 'First Form D Match',
    description: 'Earn surfaced a Form D filing that matched your thesis.',
    category: 'intelligence',
    tone: 'info',
    earned: false,
    earnedAt: null,
    progress: null
  },
  {
    id: 'signal-driven-intro',
    title: 'Signal-driven Intro',
    description: 'You turned a market signal into a warm introduction.',
    category: 'pipeline',
    tone: 'success',
    earned: false,
    earnedAt: null,
    progress: null
  },
  {
    id: 'audit-ready-week',
    title: 'Audit-Ready Week',
    description: 'Zero stale signals for seven straight days — everything on the record.',
    category: 'operations',
    tone: 'gold',
    earned: false,
    earnedAt: null,
    progress: null
  },
  {
    id: 'trust-layer-closed',
    title: 'Trust Layer Closed',
    description: 'You completed a full Chain-of-Trust layer end to end.',
    category: 'trust',
    tone: 'success',
    earned: false,
    earnedAt: null,
    progress: null
  },
  {
    id: 'pipeline-coverage-100',
    title: 'Pipeline Coverage 100%',
    description: 'Soft-circled + committed capital fully covers your target raise.',
    category: 'capital',
    tone: 'gold',
    earned: false,
    earnedAt: null,
    progress: null
  }
] as const;

/**
 * The proposal's 3 launch quests (INTELLIGENCE_LAYER_PROPOSAL.md §6), as
 * placeholder/not-started rows. Phase 2 replaces the source with the live tables.
 */
const LAUNCH_QUESTS: readonly Quest[] = [
  {
    id: 'connect-first-lp-from-signal',
    title: 'Connect Your First LP from a Signal',
    description: 'Take a market signal all the way to a replied-to introduction.',
    rewardXp: 500,
    stepsCompleted: 0,
    completedAt: null,
    steps: [
      { id: 'signal', label: 'Receive a routed signal', done: false },
      { id: 'match', label: 'Accept the LP match', done: false },
      { id: 'intro', label: 'Make the introduction', done: false },
      { id: 'reply', label: 'Get a reply', done: false }
    ]
  },
  {
    id: 'close-trust-layer-with-evidence',
    title: 'Close a Trust Layer with Signal Evidence',
    description: 'Attach external signal evidence and complete a Chain-of-Trust layer.',
    rewardXp: 400,
    stepsCompleted: 0,
    completedAt: null,
    steps: [
      { id: 'attach', label: 'Attach signal evidence', done: false },
      { id: 'verify', label: 'Verify the proof', done: false },
      { id: 'close', label: 'Close the layer', done: false }
    ]
  },
  {
    id: 'build-weekly-briefing',
    title: 'Build Your Weekly Briefing',
    description: 'Establish the operating rhythm Earn briefs you on every week.',
    rewardXp: 300,
    stepsCompleted: 0,
    completedAt: null,
    steps: [
      { id: 'configure', label: 'Configure briefing cadence', done: false },
      { id: 'review', label: 'Review the first briefing', done: false },
      { id: 'act', label: 'Act on a briefing item', done: false }
    ]
  }
] as const;

/**
 * Load the org's achievements. PLACEHOLDER: returns the locked launch badges.
 * Phase 2 swaps the body for the live read (see contract above); the
 * `.catch(() => [...LAUNCH_ACHIEVEMENTS])` fallback keeps this resilient.
 */
export async function getAchievements(orgId: string): Promise<Achievement[]> {
  return Promise.resolve(orgId)
    .then(() => LAUNCH_ACHIEVEMENTS.map((a) => ({ ...a })))
    .catch(() => LAUNCH_ACHIEVEMENTS.map((a) => ({ ...a })));
}

/**
 * Load the org's quests. PLACEHOLDER: returns the not-started launch quests.
 * Phase 2 swaps the body for the live read (see contract above); the
 * `.catch(() => [...LAUNCH_QUESTS])` fallback keeps this resilient.
 */
export async function getQuests(orgId: string): Promise<Quest[]> {
  return Promise.resolve(orgId)
    .then(() => LAUNCH_QUESTS.map((q) => ({ ...q, steps: q.steps.map((s) => ({ ...s })) })))
    .catch(() => LAUNCH_QUESTS.map((q) => ({ ...q, steps: q.steps.map((s) => ({ ...s })) })));
}

/** Whether the gamification layer is showing placeholder (pre-Phase-2) data. */
export const GAMIFICATION_IS_PLACEHOLDER = true;
