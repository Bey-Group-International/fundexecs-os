// lib/pe/mandate-tests.ts
// The investment mandate expressed as TESTS — every criterion carries a number.
// Pure, no I/O. Three native sourcing skills (mandate-screen, target-screen,
// first-look) run on this one engine so they can never disagree about what
// "passes the mandate" means.
//
// Discipline (shared with the rest of the skill runtime):
//   * a hard-limit fail ends the screen for that company;
//   * a missing field is reported as "needs-data", never guessed;
//   * every result cites the criterion that produced it;
//   * a mandate nobody has signed off labels its results "default-screened".

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Numeric deal metrics a criterion may test. Money in the deal's own unit; the rest are percentages 0–100. */
export const NUMERIC_METRICS = [
  "ebitda", // LTM adjusted EBITDA
  "revenue", // LTM revenue
  "revenueCagr3y", // 3-year revenue CAGR, %
  "ebitdaMargin", // LTM EBITDA margin, %
  "recurringRevenuePct", // % of revenue contracted
  "topCustomerPct", // top customer share of revenue, %
  "equityChequePct", // equity cheque as % of fund commitments
  "ownershipPct", // equity ownership at close, %
] as const;
export type NumericMetric = (typeof NUMERIC_METRICS)[number];

/** Text deal metrics, matched against allow / deny lists. */
export const TEXT_METRICS = ["sector", "geography", "dealType"] as const;
export type TextMetric = (typeof TEXT_METRICS)[number];

export type MetricKey = NumericMetric | TextMetric;

export const METRIC_LABELS: Record<MetricKey, string> = {
  ebitda: "LTM adjusted EBITDA",
  revenue: "LTM revenue",
  revenueCagr3y: "3-year revenue CAGR (%)",
  ebitdaMargin: "LTM EBITDA margin (%)",
  recurringRevenuePct: "Contracted recurring revenue (%)",
  topCustomerPct: "Top customer share (%)",
  equityChequePct: "Equity cheque (% of commitments)",
  ownershipPct: "Ownership at close (%)",
  sector: "Sector",
  geography: "Geography",
  dealType: "Deal type",
};

export function isNumericMetric(m: string): m is NumericMetric {
  return (NUMERIC_METRICS as readonly string[]).includes(m);
}
export function isTextMetric(m: string): m is TextMetric {
  return (TEXT_METRICS as readonly string[]).includes(m);
}

// ---------------------------------------------------------------------------
// Mandate shape
// ---------------------------------------------------------------------------

/** A band. Either bound may be open. */
export interface Band {
  min?: number;
  max?: number;
}

/** A hard limit from the LPA or a side letter. A fail ends the screen. */
export interface HardLimit {
  id: string;
  label: string;
  metric: MetricKey;
  /** Numeric metrics: the permitted band. */
  band?: Band;
  /** Text metrics: the deal's value must match one of these … */
  allow?: string[];
  /** … and must match none of these. */
  deny?: string[];
  /** Where the limit comes from, e.g. "LPA cl. 9.2". A limit with no source is a preference in disguise. */
  source?: string;
}

/** A scored preference. `strong` earns full credit, `acceptable` half. */
export interface Preference {
  id: string;
  label: string;
  metric: MetricKey;
  /** Numeric metrics. */
  strong?: Band;
  acceptable?: Band;
  /** Text metrics. */
  strongValues?: string[];
  acceptableValues?: string[];
  /** Relative weight, > 0. */
  weight: number;
}

/** A fact that ends a deal regardless of score. */
export interface KillFact {
  id: string;
  label: string;
  /** Numeric kill fact: triggered when the metric is above `above` / below `below`. */
  metric?: NumericMetric;
  above?: number;
  below?: number;
  /** Asserted-fact kill: triggered when the deal's `killFlags` lists this id or label. */
  flag?: boolean;
}

export interface MandateTests {
  /** "approved" once a partner has signed the screen; anything else is a draft. */
  status: "approved" | "draft";
  approvedBy?: string;
  hardLimits: HardLimit[];
  preferences: Preference[];
  killFacts: KillFact[];
}

export const EMPTY_MANDATE: MandateTests = { status: "draft", hardLimits: [], preferences: [], killFacts: [] };

// ---------------------------------------------------------------------------
// Deal under test
// ---------------------------------------------------------------------------

export type DealFacts = Partial<Record<NumericMetric, number>> &
  Partial<Record<TextMetric, string>> & {
    /** Kill facts the deal team has asserted (by id or label). */
    killFlags?: string[];
  };

export type TestStatus = "pass" | "fail" | "needs-data";

export interface CriterionResult {
  id: string;
  label: string;
  kind: "hard-limit" | "preference" | "kill-fact";
  status: TestStatus;
  /** Preferences only: strong | acceptable | outside. */
  fit?: "strong" | "acceptable" | "outside";
  /** The value tested, when present. */
  value?: number | string;
  /** The threshold it was tested against, rendered for people. */
  threshold: string;
  /** Plain-English reason, always citing the criterion. */
  reason: string;
}

export type ScreenResult = "pass" | "fail" | "needs-data";

export interface ScreenOutcome {
  result: ScreenResult;
  /** 0–100 weighted preference score over the preferences that could be tested; null when none could. */
  score: number | null;
  /** Share of preference weight that could be tested, 0–1. */
  scoredWeightShare: number;
  hardFails: CriterionResult[];
  killFactsTriggered: CriterionResult[];
  needsData: string[];
  criteria: CriterionResult[];
  /** "default-screened" until a partner has signed the mandate screen. */
  basis: "approved-mandate" | "default-screened";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const lc = (s: string) => s.toLowerCase().trim();

function fmtBand(b: Band | undefined): string {
  if (!b || (b.min === undefined && b.max === undefined)) return "unbounded";
  if (b.min !== undefined && b.max !== undefined) return `${b.min} to ${b.max}`;
  return b.min !== undefined ? `at least ${b.min}` : `at most ${b.max}`;
}

function inBand(v: number, b: Band | undefined): boolean {
  if (!b) return false;
  return (b.min === undefined || v >= b.min) && (b.max === undefined || v <= b.max);
}

function bandIsSet(b: Band | undefined): boolean {
  return !!b && (b.min !== undefined || b.max !== undefined);
}

function listMatches(value: string, list: string[] | undefined): boolean {
  if (!list || list.length === 0) return false;
  const v = lc(value);
  return list.some((x) => {
    const t = lc(x);
    return t !== "" && (t === v || v.includes(t) || t.includes(v));
  });
}

function numericValue(deal: DealFacts, m: MetricKey): number | undefined {
  if (!isNumericMetric(m)) return undefined;
  const v = deal[m];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function textValue(deal: DealFacts, m: MetricKey): string | undefined {
  if (!isTextMetric(m)) return undefined;
  const v = deal[m];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function evalHardLimit(limit: HardLimit, deal: DealFacts): CriterionResult {
  const base = { id: limit.id, label: limit.label, kind: "hard-limit" as const };
  const cite = limit.source ? ` (${limit.source})` : "";

  if (isNumericMetric(limit.metric)) {
    const threshold = fmtBand(limit.band);
    const v = numericValue(deal, limit.metric);
    if (!bandIsSet(limit.band)) {
      return { ...base, status: "needs-data", threshold, reason: `Hard limit "${limit.label}" has no threshold — it cannot be tested.` };
    }
    if (v === undefined) {
      return { ...base, status: "needs-data", threshold, reason: `${METRIC_LABELS[limit.metric]} not provided — "${limit.label}"${cite} cannot be tested.` };
    }
    const ok = inBand(v, limit.band);
    return {
      ...base,
      status: ok ? "pass" : "fail",
      value: v,
      threshold,
      reason: ok
        ? `${METRIC_LABELS[limit.metric]} ${v} is within "${limit.label}"${cite}: ${threshold}.`
        : `${METRIC_LABELS[limit.metric]} ${v} breaches "${limit.label}"${cite}: ${threshold}.`,
    };
  }

  // Text metric.
  const threshold = [limit.allow?.length ? `in ${limit.allow.join(" / ")}` : "", limit.deny?.length ? `not in ${limit.deny.join(" / ")}` : ""]
    .filter(Boolean)
    .join("; ");
  if (!limit.allow?.length && !limit.deny?.length) {
    return { ...base, status: "needs-data", threshold: "unbounded", reason: `Hard limit "${limit.label}" has no allow or deny list — it cannot be tested.` };
  }
  const v = textValue(deal, limit.metric);
  if (v === undefined) {
    return { ...base, status: "needs-data", threshold, reason: `${METRIC_LABELS[limit.metric]} not provided — "${limit.label}"${cite} cannot be tested.` };
  }
  // A deny hit fails outright, whatever the allow list says.
  if (listMatches(v, limit.deny)) {
    return { ...base, status: "fail", value: v, threshold, reason: `${METRIC_LABELS[limit.metric]} "${v}" is excluded by "${limit.label}"${cite}.` };
  }
  if (limit.allow?.length && !listMatches(v, limit.allow)) {
    return { ...base, status: "fail", value: v, threshold, reason: `${METRIC_LABELS[limit.metric]} "${v}" is outside "${limit.label}"${cite}: ${threshold}.` };
  }
  return { ...base, status: "pass", value: v, threshold, reason: `${METRIC_LABELS[limit.metric]} "${v}" satisfies "${limit.label}"${cite}.` };
}

function evalPreference(pref: Preference, deal: DealFacts): CriterionResult {
  const base = { id: pref.id, label: pref.label, kind: "preference" as const };

  if (isNumericMetric(pref.metric)) {
    const threshold = `strong ${fmtBand(pref.strong)}; acceptable ${fmtBand(pref.acceptable)}`;
    const v = numericValue(deal, pref.metric);
    if (!bandIsSet(pref.strong) && !bandIsSet(pref.acceptable)) {
      return { ...base, status: "needs-data", threshold, reason: `Preference "${pref.label}" has no threshold — it is not scored.` };
    }
    if (v === undefined) {
      return { ...base, status: "needs-data", threshold, reason: `${METRIC_LABELS[pref.metric]} not provided — "${pref.label}" is not scored.` };
    }
    const fit = inBand(v, pref.strong) ? "strong" : inBand(v, pref.acceptable) ? "acceptable" : "outside";
    return { ...base, status: "pass", fit, value: v, threshold, reason: `${METRIC_LABELS[pref.metric]} ${v} is ${fit} for "${pref.label}" (${threshold}).` };
  }

  const threshold = `strong ${pref.strongValues?.join(" / ") || "—"}; acceptable ${pref.acceptableValues?.join(" / ") || "—"}`;
  if (!pref.strongValues?.length && !pref.acceptableValues?.length) {
    return { ...base, status: "needs-data", threshold, reason: `Preference "${pref.label}" has no values — it is not scored.` };
  }
  const v = textValue(deal, pref.metric);
  if (v === undefined) {
    return { ...base, status: "needs-data", threshold, reason: `${METRIC_LABELS[pref.metric]} not provided — "${pref.label}" is not scored.` };
  }
  const fit = listMatches(v, pref.strongValues) ? "strong" : listMatches(v, pref.acceptableValues) ? "acceptable" : "outside";
  return { ...base, status: "pass", fit, value: v, threshold, reason: `${METRIC_LABELS[pref.metric]} "${v}" is ${fit} for "${pref.label}" (${threshold}).` };
}

function evalKillFact(kf: KillFact, deal: DealFacts): CriterionResult {
  const base = { id: kf.id, label: kf.label, kind: "kill-fact" as const };

  if (kf.metric) {
    const bits: string[] = [];
    if (kf.above !== undefined) bits.push(`above ${kf.above}`);
    if (kf.below !== undefined) bits.push(`below ${kf.below}`);
    const threshold = bits.join(" or ") || "unbounded";
    if (kf.above === undefined && kf.below === undefined) {
      return { ...base, status: "needs-data", threshold, reason: `Kill fact "${kf.label}" has no number — it cannot be tested.` };
    }
    const v = numericValue(deal, kf.metric);
    if (v === undefined) {
      return { ...base, status: "needs-data", threshold, reason: `${METRIC_LABELS[kf.metric]} not provided — kill fact "${kf.label}" cannot be tested.` };
    }
    const hit = (kf.above !== undefined && v > kf.above) || (kf.below !== undefined && v < kf.below);
    return {
      ...base,
      status: hit ? "fail" : "pass",
      value: v,
      threshold,
      reason: hit ? `Kill fact "${kf.label}": ${METRIC_LABELS[kf.metric]} ${v} is ${threshold}.` : `Kill fact "${kf.label}" not triggered (${METRIC_LABELS[kf.metric]} ${v}).`,
    };
  }

  // Asserted kill fact — only the deal team can say it is true.
  const flags = (deal.killFlags ?? []).map(lc);
  const hit = flags.includes(lc(kf.id)) || flags.includes(lc(kf.label));
  return {
    ...base,
    status: hit ? "fail" : "pass",
    threshold: "asserted by the deal team",
    reason: hit ? `Kill fact "${kf.label}" has been asserted.` : `Kill fact "${kf.label}" not asserted.`,
  };
}

/**
 * Run a deal against the mandate tests.
 *   1. kill facts and hard limits first — any fail ends the screen;
 *   2. otherwise score the preferences that could be tested;
 *   3. any hard limit that could not be tested makes the result needs-data,
 *      never a silent pass.
 */
export function screenAgainstMandate(mandate: MandateTests, deal: DealFacts): ScreenOutcome {
  const hard = mandate.hardLimits.map((h) => evalHardLimit(h, deal));
  const kills = mandate.killFacts.map((k) => evalKillFact(k, deal));
  const prefs = mandate.preferences.map((p) => evalPreference(p, deal));

  const hardFails = hard.filter((r) => r.status === "fail");
  const killFactsTriggered = kills.filter((r) => r.status === "fail");

  // Preference score over the testable weight.
  let earned = 0;
  let testable = 0;
  let total = 0;
  mandate.preferences.forEach((p, i) => {
    const w = p.weight > 0 ? p.weight : 0;
    total += w;
    const r = prefs[i];
    if (r.status !== "pass") return;
    testable += w;
    earned += w * (r.fit === "strong" ? 1 : r.fit === "acceptable" ? 0.5 : 0);
  });
  const score = testable > 0 ? Math.round((earned / testable) * 100) : null;
  const scoredWeightShare = total > 0 ? Math.round((testable / total) * 100) / 100 : 0;

  const needsData = [...hard, ...kills, ...prefs].filter((r) => r.status === "needs-data").map((r) => r.reason);
  const hardUntested = hard.some((r) => r.status === "needs-data") || kills.some((r) => r.status === "needs-data");

  // A mandate with no criteria cannot pass anything — silence is not a pass.
  if (mandate.hardLimits.length + mandate.preferences.length + mandate.killFacts.length === 0) {
    needsData.push("The mandate has no criteria — there is nothing to screen against. Define the mandate first.");
  }
  const noCriteria = mandate.hardLimits.length + mandate.preferences.length + mandate.killFacts.length === 0;

  const result: ScreenResult = hardFails.length || killFactsTriggered.length ? "fail" : hardUntested || noCriteria ? "needs-data" : "pass";

  return {
    result,
    score,
    scoredWeightShare,
    hardFails,
    killFactsTriggered,
    needsData,
    criteria: [...hard, ...kills, ...prefs],
    basis: mandate.status === "approved" ? "approved-mandate" : "default-screened",
  };
}

// ---------------------------------------------------------------------------
// Mandate audit — "turn the mandate into a written, testable screen"
// ---------------------------------------------------------------------------

export interface MandateIssue {
  severity: "blocker" | "warning";
  criterionId: string | null;
  message: string;
}

/** Statically audit a mandate: untestable criteria, unsourced hard limits, contradictions. Pure. */
export function auditMandate(mandate: MandateTests): MandateIssue[] {
  const issues: MandateIssue[] = [];
  const push = (severity: MandateIssue["severity"], criterionId: string | null, message: string) => issues.push({ severity, criterionId, message });

  // Duplicate ids make results ambiguous.
  const seen = new Set<string>();
  for (const c of [...mandate.hardLimits, ...mandate.preferences, ...mandate.killFacts]) {
    if (seen.has(c.id)) push("blocker", c.id, `Criterion id "${c.id}" is used more than once.`);
    seen.add(c.id);
  }

  if (mandate.hardLimits.length === 0) push("warning", null, "No hard limits — the screen cannot fail a deal on an LPA restriction.");
  if (mandate.preferences.length === 0) push("warning", null, "No scored preferences — survivors cannot be ranked.");

  for (const h of mandate.hardLimits) {
    const numeric = isNumericMetric(h.metric);
    const hasThreshold = numeric ? bandIsSet(h.band) : !!(h.allow?.length || h.deny?.length);
    if (!hasThreshold) push("blocker", h.id, `Hard limit "${h.label}" has no threshold. Ask for a number.`);
    if (numeric && h.band && h.band.min !== undefined && h.band.max !== undefined && h.band.min > h.band.max) {
      push("blocker", h.id, `Hard limit "${h.label}" has min ${h.band.min} above max ${h.band.max}.`);
    }
    if (!h.source?.trim()) push("warning", h.id, `Hard limit "${h.label}" cites no LPA clause or side letter — until it does, treat it as a preference.`);
    if (!numeric && h.allow?.length && h.deny?.length) {
      const clash = h.allow.filter((a) => listMatches(a, h.deny));
      if (clash.length) push("blocker", h.id, `Hard limit "${h.label}" both allows and denies: ${clash.join(", ")}.`);
    }
    if (h.metric === "ownershipPct" && h.band?.min !== undefined && h.band.min < 50) {
      push("warning", h.id, `Control limit "${h.label}" requires only ${h.band.min}% — below majority. Confirm that is control for this fund.`);
    }
  }

  let weightSum = 0;
  for (const p of mandate.preferences) {
    const numeric = isNumericMetric(p.metric);
    const hasThreshold = numeric ? bandIsSet(p.strong) || bandIsSet(p.acceptable) : !!(p.strongValues?.length || p.acceptableValues?.length);
    if (!hasThreshold) push("blocker", p.id, `Preference "${p.label}" has no threshold. Ask for a number.`);
    if (!(p.weight > 0)) push("blocker", p.id, `Preference "${p.label}" needs a weight above zero.`);
    weightSum += p.weight > 0 ? p.weight : 0;
    // A strong band that sits outside the acceptable band is a contradiction.
    if (numeric && bandIsSet(p.strong) && bandIsSet(p.acceptable)) {
      const s = p.strong!;
      const a = p.acceptable!;
      const looser = (s.min !== undefined && a.min !== undefined && s.min < a.min) || (s.max !== undefined && a.max !== undefined && s.max > a.max);
      if (looser) push("warning", p.id, `Preference "${p.label}": the strong band extends beyond the acceptable band.`);
    }
  }
  if (mandate.preferences.length > 0 && weightSum <= 0) push("blocker", null, "Preference weights sum to zero.");

  for (const k of mandate.killFacts) {
    if (k.metric && k.above === undefined && k.below === undefined) push("blocker", k.id, `Kill fact "${k.label}" names a metric but no number.`);
    if (!k.metric && !k.flag) push("warning", k.id, `Kill fact "${k.label}" has no metric; it only fires when the deal team asserts it.`);
  }

  // Cross-criterion contradiction: a hard EBITDA/revenue band that excludes the preferred one.
  for (const m of ["ebitda", "revenue"] as const) {
    const hard = mandate.hardLimits.find((h) => h.metric === m && bandIsSet(h.band));
    const pref = mandate.preferences.find((p) => p.metric === m && (bandIsSet(p.strong) || bandIsSet(p.acceptable)));
    if (hard && pref) {
      const pb = pref.strong ?? pref.acceptable!;
      const lo = Math.max(hard.band!.min ?? -Infinity, pb.min ?? -Infinity);
      const hi = Math.min(hard.band!.max ?? Infinity, pb.max ?? Infinity);
      if (lo > hi) push("blocker", pref.id, `Preference "${pref.label}" lies entirely outside hard limit "${hard.label}" — no deal can score on it.`);
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Defensive parser for the stored jsonb
// ---------------------------------------------------------------------------

function cleanNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function cleanStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function cleanList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return out.length ? out : undefined;
}
function cleanBand(v: unknown): Band | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const b: Band = {};
  const min = cleanNum(o.min);
  const max = cleanNum(o.max);
  if (min !== undefined) b.min = min;
  if (max !== undefined) b.max = max;
  return bandIsSet(b) ? b : undefined;
}
function isMetric(v: unknown): v is MetricKey {
  return typeof v === "string" && (isNumericMetric(v) || isTextMetric(v));
}

/**
 * Parse stored jsonb into MandateTests, keeping only well-typed criteria. A
 * malformed criterion is dropped, never coerced. Returns null when the input is
 * not an object. Never throws.
 */
export function parseMandateTests(raw: unknown): MandateTests | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const arr = (k: string): Record<string, unknown>[] =>
    Array.isArray(src[k]) ? (src[k] as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : [];

  const hardLimits: HardLimit[] = [];
  for (const o of arr("hardLimits")) {
    const id = cleanStr(o.id);
    const label = cleanStr(o.label);
    if (!id || !label || !isMetric(o.metric)) continue;
    hardLimits.push({ id, label, metric: o.metric, band: cleanBand(o.band), allow: cleanList(o.allow), deny: cleanList(o.deny), source: cleanStr(o.source) });
  }

  const preferences: Preference[] = [];
  for (const o of arr("preferences")) {
    const id = cleanStr(o.id);
    const label = cleanStr(o.label);
    const weight = cleanNum(o.weight);
    if (!id || !label || !isMetric(o.metric) || weight === undefined) continue;
    preferences.push({
      id,
      label,
      metric: o.metric,
      strong: cleanBand(o.strong),
      acceptable: cleanBand(o.acceptable),
      strongValues: cleanList(o.strongValues),
      acceptableValues: cleanList(o.acceptableValues),
      weight,
    });
  }

  const killFacts: KillFact[] = [];
  for (const o of arr("killFacts")) {
    const id = cleanStr(o.id);
    const label = cleanStr(o.label);
    if (!id || !label) continue;
    killFacts.push({
      id,
      label,
      metric: typeof o.metric === "string" && isNumericMetric(o.metric) ? o.metric : undefined,
      above: cleanNum(o.above),
      below: cleanNum(o.below),
      flag: o.flag === true ? true : undefined,
    });
  }

  return {
    status: src.status === "approved" ? "approved" : "draft",
    approvedBy: cleanStr(src.approvedBy),
    hardLimits,
    preferences,
    killFacts,
  };
}
