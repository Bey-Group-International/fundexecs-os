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

// The experiment key this module owns. Kept as a constant so the ledger column
// (digest_experiment_variants.experiment_key) and the code agree.
export const SUBJECT_LINE_EXPERIMENT = "subject_line";

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
