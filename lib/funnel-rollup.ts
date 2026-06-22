// lib/funnel-rollup.ts
// The Weekly Funnel Rollup — closes the funnel → digest loop.
//
// The Source Outcome Funnel (lib/source-funnel.ts, buildFunnel) measures the
// sourcing pipeline end-to-end (sourced → contacted → replied → met → mandate)
// but is pull-only: nobody sees it unless they open it. This module turns it
// proactive. Given this week's funnel and the prior week's snapshot it computes
// a rollup — per-stage count deltas, conversion-rate deltas (percentage points),
// the headline sourced→mandate change, and a few plain-language highlights — and
// composes one payload rendered for every digest channel (Slack markdown, email
// subject + body, in-app summary).
//
// PURE + deterministic, exactly like lib/radar-digest.ts: no DB, no network, no
// env, no clock surprises. The same snapshots in always yield the same payload
// out. The session-less send (lib/funnel-rollup-send.ts) handles the I/O.
import {
  FUNNEL_STAGES,
  STAGE_LABELS,
  type Funnel,
  type FunnelStage,
  type StageCounts,
} from "@/lib/source-funnel";

// ===========================================================================
// Shapes
// ===========================================================================

// One stage's movement, current vs prior: the two absolute counts and the delta.
export interface StageDelta {
  stage: FunnelStage;
  label: string;
  current: number;
  prior: number;
  // current - prior (can be negative).
  delta: number;
}

// One stage-to-stage conversion's movement, in percentage points (current rate
// minus prior rate). Both rates are the 0–100 funnel conversion rates.
export interface ConversionDelta {
  from: FunnelStage;
  to: FunnelStage;
  label: string;
  currentRate: number;
  priorRate: number;
  // currentRate - priorRate, in percentage points (can be negative).
  deltaPp: number;
}

// A single plain-language highlight — the biggest movers, surfaced for the brief.
export interface RollupHighlight {
  text: string;
  // The signed magnitude that ranked this highlight (for determinism + tests).
  magnitude: number;
}

export interface FunnelRollup {
  // True on the very first run, when there is no prior snapshot to diff.
  baseline: boolean;
  stageDeltas: StageDelta[];
  conversionDeltas: ConversionDelta[];
  // The headline: overall sourced→mandate conversion, current vs prior.
  overall: {
    current: number;
    prior: number;
    // current - prior, in percentage points.
    deltaPp: number;
  };
  // Raw current stage counts, for the brief's "where it stands now" line.
  currentCounts: StageCounts;
  // 0–3 plain-language highlights, biggest movers first.
  highlights: RollupHighlight[];
}

// ===========================================================================
// PURE — delta math (no DB, no key, unit-testable)
// ===========================================================================

// Look up the current rate for a from→to pair off a funnel's conversions list.
// Missing pair (shouldn't happen for adjacent stages) reads as 0.
function rateFor(funnel: Funnel, from: FunnelStage, to: FunnelStage): number {
  const c = funnel.conversions.find((x) => x.from === from && x.to === to);
  return c ? c.rate : 0;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Compute the rollup of a current funnel against a prior one. When `prior` is
 * null this is the first run: a baseline rollup where every delta is just the
 * current value (prior treated as 0) and a single "baseline captured" highlight.
 * Pure + deterministic — same inputs, same output.
 */
export function computeFunnelRollup(current: Funnel, prior: Funnel | null): FunnelRollup {
  const baseline = prior === null;

  const stageDeltas: StageDelta[] = FUNNEL_STAGES.map((stage) => {
    const cur = current.counts[stage] ?? 0;
    const pri = prior ? prior.counts[stage] ?? 0 : 0;
    return { stage, label: STAGE_LABELS[stage], current: cur, prior: pri, delta: cur - pri };
  });

  const conversionDeltas: ConversionDelta[] = current.conversions.map((c) => {
    const priorRate = prior ? rateFor(prior, c.from, c.to) : 0;
    return {
      from: c.from,
      to: c.to,
      label: `${STAGE_LABELS[c.from]} → ${STAGE_LABELS[c.to]}`,
      currentRate: c.rate,
      priorRate,
      deltaPp: c.rate - priorRate,
    };
  });

  const overall = {
    current: current.overallConversion,
    prior: prior ? prior.overallConversion : 0,
    deltaPp: current.overallConversion - (prior ? prior.overallConversion : 0),
  };

  const highlights = selectHighlights(baseline, stageDeltas, conversionDeltas, current);

  return {
    baseline,
    stageDeltas,
    conversionDeltas,
    overall,
    currentCounts: current.counts,
    highlights,
  };
}

/**
 * Pick the 2–3 biggest movers as plain-language highlights, deterministically.
 * Stage-count movers and conversion-rate movers compete on the absolute size of
 * their change; ties break on a stable stage/pair order so output is stable.
 * On the baseline run there is nothing to compare, so it returns one
 * "baseline captured" line. Pure.
 */
export function selectHighlights(
  baseline: boolean,
  stageDeltas: StageDelta[],
  conversionDeltas: ConversionDelta[],
  current: Funnel,
): RollupHighlight[] {
  if (baseline) {
    const sourced = current.counts.sourced ?? 0;
    const mandate = current.counts.mandate ?? 0;
    return [
      {
        text:
          `Baseline captured: ${sourced} sourced, ${mandate} mandate ` +
          `(${current.overallConversion}% overall). Next week shows what changed.`,
        magnitude: 0,
      },
    ];
  }

  type Candidate = { text: string; magnitude: number; order: number };
  const candidates: Candidate[] = [];

  // Stage-count movers. Order index keeps ties stable along the funnel order.
  stageDeltas.forEach((d, i) => {
    if (d.delta === 0) return;
    const dir = d.delta > 0 ? "up" : "down";
    candidates.push({
      text: `${d.label} ${dir} ${signed(d.delta)} (${d.prior} → ${d.current}).`,
      magnitude: Math.abs(d.delta),
      order: i,
    });
  });

  // Conversion-rate movers (percentage points). Offset order so a stage-count
  // tie sorts ahead of a conversion tie of equal magnitude, deterministically.
  conversionDeltas.forEach((c, i) => {
    if (c.deltaPp === 0) return;
    const dir = c.deltaPp > 0 ? "up" : "down";
    candidates.push({
      text: `${c.label} conversion ${dir} ${signed(c.deltaPp)}pp (${c.priorRate}% → ${c.currentRate}%).`,
      magnitude: Math.abs(c.deltaPp),
      order: 100 + i,
    });
  });

  if (candidates.length === 0) {
    return [{ text: "No material change in the funnel this week — steady state.", magnitude: 0 }];
  }

  candidates.sort((a, b) => b.magnitude - a.magnitude || a.order - b.order);
  return candidates.slice(0, 3).map((c) => ({ text: c.text, magnitude: c.magnitude }));
}

// ===========================================================================
// PURE — channel composition (mirrors lib/radar-digest.ts)
// ===========================================================================

export interface RollupMessageOptions {
  /** Cadence label for the heading. Defaults to "weekly". */
  cadence?: "weekly";
  /** Optional absolute base URL for the deep link into the funnel. */
  baseUrl?: string;
}

export interface RollupMessage {
  /** Slack-flavored markdown (mrkdwn) block. */
  slackMarkdown: string;
  /** Email subject line. */
  emailSubject: string;
  /** Email body — HTML and a plain-text fallback. */
  emailBody: { html: string; text: string };
  /** Compact one-line in-app inbox summary (the thread preview). */
  inAppSummary: string;
}

// HTML-escape for the email body — pure, no DOM. (Mirrors radar-digest.esc.)
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function funnelHref(baseUrl: string | undefined): string | null {
  const path = "/source/funnel";
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

// The headline line shared across channels: sourced→mandate, current vs prior.
function headline(rollup: FunnelRollup): string {
  if (rollup.baseline) {
    return `Funnel baseline captured — ${rollup.overall.current}% sourced→mandate.`;
  }
  const dir = rollup.overall.deltaPp > 0 ? "up" : rollup.overall.deltaPp < 0 ? "down" : "flat";
  const move =
    rollup.overall.deltaPp === 0
      ? "unchanged"
      : `${dir} ${signed(rollup.overall.deltaPp)}pp (${rollup.overall.prior}% → ${rollup.overall.current}%)`;
  return `Sourced→Mandate conversion ${move}.`;
}

/**
 * Compose the full multi-channel rollup message from a computed rollup.
 * Deterministic: same rollup + opts → same message. The single entry point the
 * send service and tests call.
 */
export function composeFunnelRollupMessage(
  rollup: FunnelRollup,
  opts: RollupMessageOptions = {},
): RollupMessage {
  const lead = "Weekly Funnel Rollup";
  const href = funnelHref(opts.baseUrl);
  const head = headline(rollup);

  // --- Slack -------------------------------------------------------------
  const slackLines: string[] = [`*${lead}*`, head];
  for (const h of rollup.highlights) slackLines.push(`• ${h.text}`);
  const stageLine = rollup.stageDeltas
    .map((d) => `${d.label} ${d.current}${rollup.baseline ? "" : ` (${signed(d.delta)})`}`)
    .join(" · ");
  slackLines.push(`_${stageLine}_`);
  if (href) slackLines.push(`→ <${href}|Open the funnel>`);
  const slackMarkdown = slackLines.join("\n");

  // --- Email subject -----------------------------------------------------
  const emailSubject = rollup.baseline
    ? `${lead} — baseline captured (${rollup.overall.current}% sourced→mandate)`
    : rollup.overall.deltaPp === 0
      ? `${lead} — sourced→mandate steady at ${rollup.overall.current}%`
      : `${lead} — sourced→mandate ${signed(rollup.overall.deltaPp)}pp to ${rollup.overall.current}%`;

  // --- Email body (HTML + text) ------------------------------------------
  const highlightsHtml = rollup.highlights.map((h) => `<li>${esc(h.text)}</li>`).join("");
  const stageRowsHtml = rollup.stageDeltas
    .map(
      (d) =>
        `<li><strong>${esc(d.label)}</strong>: ${d.current}` +
        (rollup.baseline ? "" : ` (${esc(signed(d.delta))} vs prior week)`) +
        `</li>`,
    )
    .join("");
  const linkHtml = href ? `<p>→ <a href="${esc(href)}">Open the funnel</a></p>` : "";
  const html =
    `<h2>${esc(lead)}</h2><p>${esc(head)}</p>` +
    `<h3>Highlights</h3><ul>${highlightsHtml}</ul>` +
    `<h3>Stages now</h3><ul>${stageRowsHtml}</ul>` +
    linkHtml;

  const highlightsText = rollup.highlights.map((h) => `• ${h.text}`).join("\n");
  const stageRowsText = rollup.stageDeltas
    .map((d) => `  ${d.label}: ${d.current}${rollup.baseline ? "" : ` (${signed(d.delta)})`}`)
    .join("\n");
  const text = [
    lead,
    "",
    head,
    "",
    "Highlights:",
    highlightsText,
    "",
    "Stages now:",
    stageRowsText,
    ...(href ? ["", `-> Open the funnel: ${href}`] : []),
  ].join("\n");

  // --- In-app summary ----------------------------------------------------
  const lead0 = rollup.highlights[0]?.text ?? head;
  const inAppSummary = `${lead}: ${lead0}`;

  return {
    slackMarkdown,
    emailSubject,
    emailBody: { html, text },
    inAppSummary,
  };
}

export const __test = {
  computeFunnelRollup,
  selectHighlights,
  composeFunnelRollupMessage,
};
