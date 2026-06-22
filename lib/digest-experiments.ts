// lib/digest-experiments.ts
// Subject-line A/B experiments for the Act-now Radar digest — PURE, deterministic.
//
// The digest (lib/radar-digest.ts) ships ranked Radar rows; engagement
// (opens/clicks) is captured per send in radar_digest_engagement. This module is
// the brains of the A/B loop: it defines the subject-line variants, picks one
// deterministically per (org, period) so a given org stays on a stable variant
// within a period (no clock/random → testable + reproducible), and summarizes
// which variant drives more engagement so the winner can be preferred.
//
// No DB, no network, no env, no clock: the same inputs always yield the same
// output. The send service (lib/radar-send.ts) does the I/O — it picks a variant
// here, composes the digest with it, and persists the assignment.

import { createHash } from "crypto";

// The experiment keys this module owns. Kept as constants so the ledger column
// (digest_experiment_variants.experiment_key) and the code agree. Both
// experiments share the same ledger table + the same engagement telemetry — they
// differ only by `experiment_key`, so a single summary path can measure either.
export const SUBJECT_LINE_EXPERIMENT = "subject_line";
export const SEND_TIME_EXPERIMENT = "send_time";

/**
 * One subject-line variant. `key` is the stable id persisted in the ledger;
 * `render` turns the default subject (the byte-identical "today" subject the
 * composer already produces) into this variant's subject. `control` renders the
 * default unchanged, so the experiment is opt-in per variant and the default
 * path is never altered.
 */
export interface SubjectVariant {
  /** Stable id stored in digest_experiment_variants.variant. */
  key: string;
  /** Human label for dashboards. */
  label: string;
  /**
   * Transform the default subject into this variant's subject. PURE. Receives
   * the composer's default subject plus a small context bag (count + top name)
   * so variants can be expressive without re-deriving the digest.
   */
  render: (ctx: SubjectContext) => string;
}

/** The minimal context a subject variant needs — derived from the digest. */
export interface SubjectContext {
  /** The default subject the composer would otherwise use. */
  defaultSubject: string;
  /** Number of rows in the digest (0 = empty state). */
  count: number;
  /** Name of the top row, or null when empty. */
  topName: string | null;
  /** "Daily" | "Weekly" cadence label, already capitalized. */
  cadenceLabel: string;
}

/**
 * The subject-line variants under test. `control` is the byte-identical default
 * (so picking it never changes output); the others reframe the same brief with a
 * different hook. Order is stable — it's the deterministic pick's index space.
 */
export const SUBJECT_VARIANTS: readonly SubjectVariant[] = [
  {
    key: "control",
    label: "Control (default)",
    render: (ctx) => ctx.defaultSubject,
  },
  {
    key: "urgent",
    label: "Urgency framing",
    render: (ctx) =>
      ctx.count === 0
        ? `${ctx.cadenceLabel} Act-now Radar — all clear`
        : `Act now: ${ctx.count} ${ctx.count === 1 ? "move" : "moves"} need you today`,
  },
  {
    key: "curiosity",
    label: "Curiosity framing",
    render: (ctx) =>
      ctx.count === 0 || !ctx.topName
        ? `${ctx.cadenceLabel} Act-now Radar — nothing new to chase`
        : `${ctx.topName} is heating up — see who else made the cut`,
  },
];

/** Look up a variant by key, or undefined when unknown. Pure. */
export function findVariant(
  key: string,
  variants: readonly SubjectVariant[] = SUBJECT_VARIANTS,
): SubjectVariant | undefined {
  return variants.find((v) => v.key === key);
}

/**
 * A stable 32-bit unsigned hash of a string via SHA-256. Deterministic across
 * runs and machines (no Math.random, no Date) so a pick is reproducible and a
 * test can assert exact assignments. Pure.
 */
function stableHash(input: string): number {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

/**
 * Deterministically pick a subject-line variant for an org + period. The same
 * (orgId, periodKey) always maps to the same variant within a period, so an org
 * sees a consistent subject style across that period's sends (and a test can
 * pin the result). Different periods reshuffle, so over time an org is exposed
 * to every variant — the data needed to find a winner. Pure: no clock, no random.
 *
 * `periodKey` is the cadence bucket the caller derives (e.g. "2026-06-22" daily
 * or "2026-W25" weekly) — kept as a caller-supplied string so this stays clock-free.
 */
export function pickVariant(
  orgId: string,
  periodKey: string,
  variants: readonly SubjectVariant[] = SUBJECT_VARIANTS,
): SubjectVariant {
  if (variants.length === 0) {
    throw new Error("pickVariant requires at least one variant");
  }
  const idx = stableHash(`${orgId}::${periodKey}`) % variants.length;
  return variants[idx];
}

// --- Send-time experiment ----------------------------------------------------
//
// The second A/B knob: WHEN the digest lands, not just what its subject says.
// It reuses the exact same ledger (digest_experiment_variants) under
// experiment_key='send_time' and the same engagement telemetry, so the very
// same summary path measures open/click rates per send-time window. Recording
// here is independent of the subject pick (a different hash salt) so the two
// experiments don't correlate. (Scope: this records + measures the window;
// gating actual delivery to the window is a follow-up — see PR notes.)

/**
 * One send-time window variant. `key` is the stable id persisted in the ledger;
 * `startHour`/`endHour` bound the local hour-of-day window the digest targets.
 */
export interface SendTimeVariant {
  /** Stable id stored in digest_experiment_variants.variant. */
  key: string;
  /** Human label for dashboards. */
  label: string;
  /** Inclusive start hour of the window (0–23, local). */
  startHour: number;
  /** Exclusive end hour of the window (1–24, local). */
  endHour: number;
}

/**
 * The send-time windows under test — a small set of hour-of-day buckets. Order
 * is stable: it's the deterministic pick's index space.
 */
export const SEND_TIME_VARIANTS: readonly SendTimeVariant[] = [
  { key: "morning", label: "Morning (7–10am)", startHour: 7, endHour: 10 },
  { key: "midday", label: "Midday (11am–2pm)", startHour: 11, endHour: 14 },
  { key: "afternoon", label: "Afternoon (3–6pm)", startHour: 15, endHour: 18 },
];

/** Look up a send-time variant by key, or undefined when unknown. Pure. */
export function findSendTimeVariant(
  key: string,
  variants: readonly SendTimeVariant[] = SEND_TIME_VARIANTS,
): SendTimeVariant | undefined {
  return variants.find((v) => v.key === key);
}

/**
 * Deterministically pick a send-time window for an org + period. Same approach
 * as pickVariant (stable hash of org + period → index) but with an independent
 * salt, so the send-time assignment does NOT correlate with the subject-line
 * assignment for the same (org, period). Pure: no clock, no random.
 */
export function pickSendTimeVariant(
  orgId: string,
  periodKey: string,
  variants: readonly SendTimeVariant[] = SEND_TIME_VARIANTS,
): SendTimeVariant {
  if (variants.length === 0) {
    throw new Error("pickSendTimeVariant requires at least one variant");
  }
  // Distinct salt ("send_time::") keeps this pick independent of the subject pick.
  const idx = stableHash(`${SEND_TIME_EXPERIMENT}::${orgId}::${periodKey}`) % variants.length;
  return variants[idx];
}

// --- Performance summary -----------------------------------------------------

/**
 * One row of "what was assigned + what it earned": a variant assignment joined
 * with its send's engagement counts (from radar_digest_engagement, grouped by
 * action). One row per digest send. `opens`/`clicks` default to 0 when a send
 * drew no engagement.
 */
export interface VariantEngagementRow {
  variant: string;
  /** Distinct digest sends assigned this variant — the denominator. */
  sends?: number;
  opens: number;
  clicks: number;
}

/** Aggregated performance for a single variant. */
export interface VariantPerformance {
  variant: string;
  sends: number;
  opens: number;
  clicks: number;
  /** opens / sends, 0 when no sends. */
  openRate: number;
  /** clicks / sends, 0 when no sends. */
  clickRate: number;
}

export interface VariantPerformanceSummary {
  variants: VariantPerformance[];
  /**
   * The current leader's variant key, or null on an empty state (no rows). The
   * leader maximizes click rate, then open rate, then send volume; ties broken
   * by variant key (ascending) for determinism.
   */
  leader: string | null;
}

/**
 * Aggregate variant-assignment + engagement rows into per-variant open/click
 * rates and the current leader. Rows are grouped by variant key, so multiple
 * rows for one variant (e.g. one per send) fold together. Pure + deterministic:
 * same rows in (any order) → same summary out.
 *
 * Each input row is one send: `sends` defaults to 1 (one assignment = one send)
 * so callers can pass raw joined rows, or an explicit count for pre-grouped data.
 */
export function summarizeVariantPerformance(
  rows: VariantEngagementRow[],
): VariantPerformanceSummary {
  const byVariant = new Map<string, VariantPerformance>();
  for (const row of rows) {
    const cur =
      byVariant.get(row.variant) ??
      ({
        variant: row.variant,
        sends: 0,
        opens: 0,
        clicks: 0,
        openRate: 0,
        clickRate: 0,
      } as VariantPerformance);
    cur.sends += typeof row.sends === "number" ? row.sends : 1;
    cur.opens += row.opens || 0;
    cur.clicks += row.clicks || 0;
    byVariant.set(row.variant, cur);
  }

  const variants = [...byVariant.values()]
    .map((v) => ({
      ...v,
      openRate: v.sends > 0 ? v.opens / v.sends : 0,
      clickRate: v.sends > 0 ? v.clicks / v.sends : 0,
    }))
    // Stable, deterministic order for display + leader selection.
    .sort(
      (a, b) =>
        b.clickRate - a.clickRate ||
        b.openRate - a.openRate ||
        b.sends - a.sends ||
        a.variant.localeCompare(b.variant),
    );

  return { variants, leader: variants.length > 0 ? variants[0].variant : null };
}

/**
 * A variant-engagement row tagged with the experiment it belongs to, so a mixed
 * stream of ledger rows (subject_line + send_time, joined to the same engagement
 * table) can be summarized per experiment in one pass.
 */
export interface KeyedVariantEngagementRow extends VariantEngagementRow {
  experimentKey: string;
}

/**
 * Summarize variant performance split by experiment_key. Rows for different
 * experiments (subject_line vs send_time) are bucketed by `experimentKey`, then
 * each bucket is run through summarizeVariantPerformance — so each experiment
 * gets its own per-variant open/click rates + leader from the SAME telemetry.
 * Pure + deterministic: same rows in (any order) → same map out.
 */
export function summarizeByExperiment(
  rows: KeyedVariantEngagementRow[],
): Record<string, VariantPerformanceSummary> {
  const byKey = new Map<string, VariantEngagementRow[]>();
  for (const row of rows) {
    const bucket = byKey.get(row.experimentKey) ?? [];
    bucket.push({
      variant: row.variant,
      sends: row.sends,
      opens: row.opens,
      clicks: row.clicks,
    });
    byKey.set(row.experimentKey, bucket);
  }
  const out: Record<string, VariantPerformanceSummary> = {};
  for (const [key, bucket] of byKey) {
    out[key] = summarizeVariantPerformance(bucket);
  }
  return out;
}
