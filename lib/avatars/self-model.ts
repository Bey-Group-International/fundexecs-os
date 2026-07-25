// lib/avatars/self-model.ts
// The agentic self-model — the deterministic FAST loop from the LIVING-EXECS
// spec (docs/avatars/AVATAR_SYSTEM_SPEC.md §5). Renderer-agnostic and pure:
// perception updates internal state, a utility scorer picks a behavior with a
// safe fallback, and introspection explains the current intent from templates
// (the optional LLM slow loop can enrich `say` later, but is never required).
//
// All reducers are pure functions of (state, input) → new state, so behavior is
// fully testable and free of randomness or wall-clock reads.

import type { BehaviorProfile, GoalSpec } from "@/lib/avatars/descriptor";
import { clamp01 } from "@/lib/avatars/descriptor";

export interface Drives {
  energy: number;
  focus: number;
  social: number;
}

export interface Affect {
  mood: string;
  confidence: number;
  valence: number; // pleasantness, [0,1]
  arousal: number; // activation, [0,1]
}

export interface Context {
  zone?: string;
  nearby: string[];
  timeOfDay?: string;
  lastSignal?: string;
}

export interface MemoryItem {
  /** Monotonic tick index (NOT wall-clock — the caller owns the clock). */
  t: number;
  type: string;
  summary: string;
  /** Importance in [0,1]; drives eviction when the ring buffer is full. */
  salience: number;
}

export interface SelfState {
  goals: GoalSpec[];
  activeGoal: string | null;
  activeBehavior: string;
  drives: Drives;
  affect: Affect;
  context: Context;
  memory: MemoryItem[];
  /** Monotonic tick counter used to timestamp memory. */
  t: number;
}

/** A perception signal on the bus (spec §5.2). */
export interface Signal {
  type: string;
  /** Free-form payload; a few well-known keys are read below. */
  zone?: string;
  nearby?: string[];
  timeOfDay?: string;
  agent?: string;
  text?: string;
  salience?: number;
}

/** The canonical introspection response (spec §5.5). */
export interface Introspection {
  say: string;
  intent: string;
  because: string[];
  confidence: number;
  focus: string;
  energy: number;
  mood: string;
  next?: string;
}

export const MEMORY_CAP = 16;

/** Derive a mood label from affect + drives — a readout, not a driver. */
function moodFor(drives: Drives, affect: Affect): string {
  if (drives.energy < 0.3) return "tired";
  if (affect.confidence >= 0.7 && affect.valence >= 0.55) return "confident";
  if (affect.valence < 0.4) return "concerned";
  if (drives.focus >= 0.7) return "focused";
  return "steady";
}

export function initState(profile: BehaviorProfile): SelfState {
  const drives: Drives = { ...profile.baseline };
  const affect: Affect = {
    mood: "steady",
    confidence: 0.5 + (profile.personality.stability - 0.5) * 0.5,
    valence: 0.5,
    arousal: 0.4,
  };
  affect.mood = moodFor(drives, affect);
  const topGoal = [...profile.goals].sort((a, b) => b.priority - a.priority)[0];
  return {
    goals: profile.goals.map((g) => ({ ...g, progress: g.progress ?? 0 })),
    activeGoal: topGoal ? topGoal.id : null,
    activeBehavior: "idle",
    drives,
    affect,
    context: { nearby: [] },
    memory: [],
    t: 0,
  };
}

/** Push an event into the salience-weighted, fixed-size memory ring. */
export function remember(state: SelfState, item: Omit<MemoryItem, "t">): SelfState {
  const memory = [...state.memory, { ...item, t: state.t }];
  if (memory.length > MEMORY_CAP) {
    // Evict the lowest-salience item (ties → oldest), keeping the buffer bounded.
    let worst = 0;
    for (let i = 1; i < memory.length; i++) {
      if (memory[i].salience < memory[worst].salience) worst = i;
    }
    memory.splice(worst, 1);
  }
  return { ...state, memory };
}

/**
 * Perceive a signal: advance the clock, merge context, nudge drives/affect, and
 * record salient events to memory. Pure — returns a new state.
 */
export function perceive(state: SelfState, signal: Signal): SelfState {
  let next: SelfState = { ...state, t: state.t + 1 };
  const context: Context = { ...state.context };
  if (signal.zone !== undefined) context.zone = signal.zone;
  if (signal.nearby !== undefined) context.nearby = signal.nearby;
  if (signal.timeOfDay !== undefined) context.timeOfDay = signal.timeOfDay;
  context.lastSignal = signal.type;
  next.context = context;

  const drives = { ...next.drives };
  const affect = { ...next.affect };
  switch (signal.type) {
    case "raise.funded":
      affect.valence = clamp01(affect.valence + 0.15);
      affect.confidence = clamp01(affect.confidence + 0.1);
      affect.arousal = clamp01(affect.arousal + 0.1);
      break;
    case "raise.stalled":
      affect.valence = clamp01(affect.valence - 0.12);
      break;
    case "raise.tick":
      affect.arousal = clamp01(affect.arousal + 0.04);
      break;
    case "user.select":
    case "user.attention":
      affect.arousal = clamp01(affect.arousal + 0.05);
      break;
    default:
      break;
  }
  next.drives = drives;
  next.affect = { ...affect, mood: moodFor(drives, affect) };

  const salience = signal.salience ?? (signal.type.startsWith("raise") ? 0.7 : 0.4);
  if (signal.text || signal.type.startsWith("raise") || signal.type.startsWith("user")) {
    next = remember(next, {
      type: signal.type,
      summary: signal.text ?? `${signal.type}${signal.agent ? `:${signal.agent}` : ""}`,
      salience,
    });
  }
  return next;
}

/**
 * Homeostatic tick: drives relax toward their baselines and are perturbed by the
 * active behavior (working drains energy but sharpens focus; resting recovers).
 * `dt` is in seconds; `baseline` comes from the descriptor's BehaviorProfile.
 */
export function tickDrives(
  state: SelfState,
  dt: number,
  baseline: Drives,
): SelfState {
  const k = Math.min(1, dt * 0.2); // relaxation rate toward baseline
  const drives: Drives = {
    energy: state.drives.energy + (baseline.energy - state.drives.energy) * k,
    focus: state.drives.focus + (baseline.focus - state.drives.focus) * k,
    social: state.drives.social + (baseline.social - state.drives.social) * k,
  };
  if (state.activeBehavior === "work_at_desk") {
    drives.energy = clamp01(drives.energy - dt * 0.03);
    drives.focus = clamp01(drives.focus + dt * 0.02);
  } else if (state.activeBehavior === "take_break") {
    drives.energy = clamp01(drives.energy + dt * 0.05);
  }
  const affect = { ...state.affect, mood: moodFor(drives, state.affect) };
  return { ...state, drives, affect };
}

export interface BehaviorChoice {
  behavior: string;
  goal: string | null;
  score: number;
}

/**
 * Utility behavior selection with a guaranteed safe fallback (spec §5.3):
 * score a small candidate set from goals + drives + context; if nothing clears
 * the threshold, fall back to Idle (or ReturnHome when energy is critically low).
 */
export function selectBehavior(state: SelfState, profile: BehaviorProfile): BehaviorChoice {
  const topGoal = [...state.goals].sort((a, b) => b.priority - a.priority)[0] ?? null;
  const candidates: BehaviorChoice[] = [];

  if (topGoal && topGoal.kind === "work") {
    candidates.push({
      behavior: "work_at_desk",
      goal: topGoal.id,
      score: topGoal.priority * (0.4 + state.drives.energy * 0.6),
    });
  }
  if (state.context.nearby.length > 0) {
    candidates.push({
      behavior: "converse",
      goal: state.goals.find((g) => g.kind === "social")?.id ?? topGoal?.id ?? null,
      score: profile.socialBias * (0.3 + state.drives.social * 0.7),
    });
  }
  if (state.context.lastSignal === "raise.funded" || state.context.lastSignal === "raise.tick") {
    candidates.push({ behavior: "observe_raise", goal: topGoal?.id ?? null, score: 0.6 });
  }
  if (state.drives.energy < 0.25) {
    candidates.push({ behavior: "take_break", goal: null, score: 0.9 });
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  const THRESHOLD = 0.2;
  if (!best || best.score < THRESHOLD) {
    // Safe fallback: nothing worth doing → idle in place (spec §5.3). Nav-failure
    // ReturnHome is a renderer/pathing concern, handled where movement lives.
    return { behavior: "idle", goal: topGoal ? topGoal.id : null, score: 0 };
  }
  return best;
}

/** Apply a behavior choice to the state (sets activeBehavior/activeGoal). */
export function commit(state: SelfState, choice: BehaviorChoice): SelfState {
  return { ...state, activeBehavior: choice.behavior, activeGoal: choice.goal };
}

const BEHAVIOR_PHRASING: Record<string, (ctx: Context) => string> = {
  work_at_desk: () => "Heads-down on my current work",
  converse: (c) => `Syncing with ${c.nearby[0] ?? "a colleague"}`,
  observe_raise: (c) => `Watching the raises${c.zone ? ` from the ${c.zone}` : ""}`,
  take_break: () => "Taking a short break to recover",
  return_home: () => "Heading back to my desk",
  idle: () => "Standing by — nothing pressing right now",
};

/**
 * Compose an intent explanation from the current state (local templates). The
 * optional LLM slow loop can replace `say` with richer phrasing, but this always
 * returns a sensible answer with no network or model dependency (spec §5.4/§5.5).
 */
export function introspect(state: SelfState, profile: BehaviorProfile): Introspection {
  const phrase = BEHAVIOR_PHRASING[state.activeBehavior] ?? (() => "Working");
  const because: string[] = [];
  const goal = state.goals.find((g) => g.id === state.activeGoal);
  if (goal) because.push(`goal:${goal.id}(${goal.priority.toFixed(2)})`);
  if (state.context.lastSignal) because.push(`signal:${state.context.lastSignal}`);
  if (state.context.nearby.length) because.push(`nearby:${state.context.nearby[0]}`);

  let next: string | undefined;
  if (state.drives.energy < 0.3) next = "take a short break soon";
  else if (state.context.nearby.length && state.activeBehavior !== "converse") {
    next = `if ${state.context.nearby[0]} is free, sync briefly`;
  }

  return {
    say: phrase(state.context) + ".",
    intent: state.activeBehavior,
    because,
    confidence: +state.affect.confidence.toFixed(2),
    focus: goal ? goal.id : "none",
    energy: +state.drives.energy.toFixed(2),
    mood: state.affect.mood,
    next,
  };
}

/** Convenience: one fast-loop step — perceive (optional) → tick → select → commit. */
export function step(
  state: SelfState,
  profile: BehaviorProfile,
  opts: { dt?: number; signal?: Signal } = {},
): SelfState {
  let s = state;
  if (opts.signal) s = perceive(s, opts.signal);
  if (opts.dt) s = tickDrives(s, opts.dt, profile.baseline);
  return commit(s, selectBehavior(s, profile));
}
