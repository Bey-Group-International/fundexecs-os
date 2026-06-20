// Mission control: consolidates each hub's headline signal + next-best action
// into one glanceable strip at the top of the dashboard. It calls the four
// per-hub command-center engines (Build readiness, Run conviction, Source
// momentum, Execute performance) in parallel and flattens them into a single,
// uniform shape — so the operator sees, at a glance, where each hub stands and
// the one move that advances it. Each hub is wrapped in its own try/catch so a
// single engine failure degrades that one tile rather than sinking the row.
import type { Hub } from "@/lib/supabase/database.types";
import { getBuildReadiness } from "@/lib/build-readiness";
import { getRunConviction } from "@/lib/run-conviction";
import { getSourceMomentum } from "@/lib/source-readiness";
import { getExecutePerformance } from "@/lib/execute-performance";

/** The single tone a score maps to, used to color the ring / metric. */
export type SignalTone = "good" | "warn" | "muted";

export interface HubSignal {
  hub: Hub;
  label: string;
  /** Where the whole tile links — the hub's command-center entry point. */
  href: string;
  /** 0–100 headline score, or null for hubs with no 0–100 (Execute). */
  score: number | null;
  /** Compact headline metric, e.g. "72% conviction", "Operating · 1.8x TVPI". */
  metric: string;
  /** The single next-best move for this hub, or null when nothing is pending. */
  nextAction: { label: string; href: string } | null;
}

export interface MissionControl {
  hubs: HubSignal[];
}

// --- Pure shaping helpers (unit-tested in mission-control.test.ts) ----------

/**
 * Tone for a 0–100 score: strong (good), in-progress (warn), or barely-started
 * (muted). A null score (hubs with no 0–100, e.g. Execute) reads as muted.
 */
export function scoreTone(score: number | null): SignalTone {
  if (score == null) return "muted";
  if (score >= 70) return "good";
  if (score >= 35) return "warn";
  return "muted";
}

/** Format a multiple (e.g. 1.8) as "1.8x", trimming a trailing ".0". */
export function formatMultiple(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.round(value * 100) / 100;
  const fixed = rounded.toFixed(1);
  return `${fixed.endsWith(".0") ? String(Math.round(rounded)) : fixed}x`;
}

/**
 * Assemble the Execute hero metric — its lifecycle stage plus the hero multiple
 * and its label, e.g. "Operating · 1.8x TVPI". Falls back to just the stage
 * when there's no multiple yet.
 */
export function formatExecuteMetric(
  stageLabel: string,
  heroMultiple: number | null,
  heroLabel: string,
): string {
  if (heroMultiple == null) return stageLabel;
  return `${stageLabel} · ${formatMultiple(heroMultiple)} ${heroLabel}`;
}

// --- Aggregator -------------------------------------------------------------

/**
 * Compute the mission-control row for an org: the four hub engines run in
 * parallel, each shaped into a uniform HubSignal. Per-hub try/catch keeps one
 * failing engine from collapsing the whole strip.
 */
export async function getMissionControl(orgId: string): Promise<MissionControl> {
  const [build, run, source, execute] = await Promise.all([
    buildSignal(orgId),
    runSignal(orgId),
    sourceSignal(orgId),
    executeSignal(orgId),
  ]);

  // Preserve hub order; drop any that hard-failed without a fallback.
  const hubs = [build, run, source, execute].filter((h): h is HubSignal => h != null);
  return { hubs };
}

async function buildSignal(orgId: string): Promise<HubSignal> {
  try {
    const r = await getBuildReadiness(orgId);
    return {
      hub: "build",
      label: "Build",
      href: "/build/profile",
      score: r.overall,
      metric: `${r.overall}% foundation · ${r.stage.label}`,
      nextAction: r.nextAction ? { label: r.nextAction.label, href: r.nextAction.href } : null,
    };
  } catch {
    return fallbackSignal("build", "Build", "/build/profile");
  }
}

async function runSignal(orgId: string): Promise<HubSignal> {
  try {
    const r = await getRunConviction(orgId);
    return {
      hub: "run",
      label: "Run",
      href: "/run/strategy",
      score: r.overall,
      metric: `${r.benchmark.dealsInEval} in evaluation · ${r.overall}% conviction`,
      nextAction: r.nextAction ? { label: r.nextAction.label, href: r.nextAction.href } : null,
    };
  } catch {
    return fallbackSignal("run", "Run", "/run/strategy");
  }
}

async function sourceSignal(orgId: string): Promise<HubSignal> {
  try {
    const r = await getSourceMomentum(orgId);
    return {
      hub: "source",
      label: "Source",
      href: "/source/lp_pipeline",
      score: r.overall,
      metric: `${r.overall}% raise readiness · ${r.stage.label}`,
      nextAction: r.nextAction ? { label: r.nextAction.label, href: r.nextAction.href } : null,
    };
  } catch {
    return fallbackSignal("source", "Source", "/source/lp_pipeline");
  }
}

async function executeSignal(orgId: string): Promise<HubSignal> {
  try {
    const r = await getExecutePerformance(orgId);
    return {
      hub: "execute",
      label: "Execute",
      href: "/execute/reporting",
      score: null, // no 0–100 — Execute leads with a multiple, not a meter
      metric: formatExecuteMetric(r.stage.label, r.heroMultiple, r.heroLabel),
      nextAction: r.nextAction ? { label: r.nextAction.label, href: r.nextAction.href } : null,
    };
  } catch {
    return fallbackSignal("execute", "Execute", "/execute/reporting");
  }
}

/** A degraded tile shown when a hub engine throws — keeps the strip intact. */
function fallbackSignal(hub: Hub, label: string, href: string): HubSignal {
  return { hub, label, href, score: null, metric: "Unavailable", nextAction: null };
}
