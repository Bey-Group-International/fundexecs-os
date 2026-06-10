import type { LoopVerb } from '@/lib/loop-chain';
import { LOOP_EVENT_TYPES } from '@/lib/loop-events';
import { compactMoney } from '@/lib/format';

/**
 * lib/loop-pulse.ts — per-verb outcome pulses from the loop_events stream (pure).
 *
 * Wave 3 of the verb-hub consolidation: the telemetry the loop has been
 * accumulating since #292 becomes a visible scoreboard. Each hub's hero gains
 * a one-line pulse — what the verb actually *did* recently:
 *
 *   Source — deals sourced (count + dollars entering the funnel)
 *   Run    — decisions made, with the median days from entering diligence
 *            to the decision (decision velocity)
 *   Drive  — closes landed (count + dollars)
 *   Build  — proof credits compounded into the record (the flywheel, visible)
 *
 * Pure + deterministic: rows in, pulse out, `now` injected for testability.
 * The stream read lives in `lib/queries/loop-pulse.ts`. A verb with no
 * relevant events returns null — hubs render a calm nothing, never a zero.
 */

/** One loop_events row, as the pulse reads it. */
export interface LoopEventRow {
  verb: LoopVerb;
  eventType: string;
  entityId: string | null;
  /** ISO timestamp. */
  createdAt: string;
  metadata: Record<string, unknown>;
}

/** A verb's recent-outcome line on its hub hero. */
export interface VerbPulse {
  /** The outcome, e.g. "3 closes · $2.5M". */
  headline: string;
  /** The context, e.g. "last 30 days · median 6d to decide". */
  detail: string;
}

/** The pulse window. */
export const PULSE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

function parseTime(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function inWindow(row: LoopEventRow, nowMs: number): boolean {
  const t = parseTime(row.createdAt);
  return t > 0 && nowMs - t <= PULSE_WINDOW_DAYS * DAY_MS && t <= nowMs;
}

function metaNumber(metadata: Record<string, unknown>, key: string): number {
  const v = Number(metadata[key]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const v = metadata[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const WINDOW_LABEL = `last ${PULSE_WINDOW_DAYS} days`;

/** Source: deals that entered the funnel in the window. */
function sourcePulse(rows: LoopEventRow[], nowMs: number): VerbPulse | null {
  const created = rows.filter(
    (r) => r.eventType === LOOP_EVENT_TYPES.dealCreated && inWindow(r, nowMs)
  );
  if (created.length === 0) return null;
  const sum = created.reduce((acc, r) => acc + metaNumber(r.metadata, 'amount'), 0);
  const headline =
    sum > 0
      ? `${plural(created.length, 'deal')} sourced · ${compactMoney(sum)}`
      : `${plural(created.length, 'deal')} sourced`;
  return { headline, detail: WINDOW_LABEL };
}

/**
 * Run: decisions in the window + decision velocity — the median days from the
 * deal entering diligence (its `deal_stage: diligence` event) to the decision
 * (the run-verb `loop_closed`, which carries `dealId` in metadata).
 */
function runPulse(rows: LoopEventRow[], nowMs: number): VerbPulse | null {
  const decisions = rows.filter(
    (r) => r.verb === 'run' && r.eventType === LOOP_EVENT_TYPES.loopClosed && inWindow(r, nowMs)
  );
  if (decisions.length === 0) return null;

  const daysToDecide: number[] = [];
  for (const decision of decisions) {
    const dealId = metaString(decision.metadata, 'dealId');
    if (!dealId) continue;
    const decidedAt = parseTime(decision.createdAt);
    // The most recent time this deal entered diligence before the decision.
    const entered = rows
      .filter(
        (r) =>
          r.eventType === LOOP_EVENT_TYPES.dealStage &&
          r.entityId === dealId &&
          metaString(r.metadata, 'stage') === 'diligence' &&
          parseTime(r.createdAt) <= decidedAt
      )
      .map((r) => parseTime(r.createdAt))
      .sort((a, b) => b - a)[0];
    if (entered) daysToDecide.push((decidedAt - entered) / DAY_MS);
  }

  const med = median(daysToDecide);
  const detail =
    med !== null
      ? `${WINDOW_LABEL} · median ${Math.max(1, Math.round(med))}d to decide`
      : WINDOW_LABEL;
  return { headline: plural(decisions.length, 'decision'), detail };
}

/** Drive: closes landed in the window (count + dollars when carried). */
function drivePulse(rows: LoopEventRow[], nowMs: number): VerbPulse | null {
  const closes = rows.filter(
    (r) => r.verb === 'drive' && r.eventType === LOOP_EVENT_TYPES.loopClosed && inWindow(r, nowMs)
  );
  if (closes.length === 0) return null;
  const sum = closes.reduce((acc, r) => acc + metaNumber(r.metadata, 'amount'), 0);
  const headline =
    sum > 0
      ? `${plural(closes.length, 'close')} · ${compactMoney(sum)}`
      : plural(closes.length, 'close');
  return { headline, detail: WINDOW_LABEL };
}

/**
 * Build: proof credits compounded into the record in the window — every
 * credited loop close (any verb) strengthened a Chain-of-Trust layer.
 */
function buildPulse(rows: LoopEventRow[], nowMs: number): VerbPulse | null {
  const credits = rows.filter(
    (r) =>
      r.eventType === LOOP_EVENT_TYPES.loopClosed &&
      r.metadata['credited'] === true &&
      inWindow(r, nowMs)
  );
  if (credits.length === 0) return null;
  return {
    headline: plural(credits.length, 'proof credit'),
    detail: `${WINDOW_LABEL} · compounding into your record`
  };
}

/** Derive one verb's pulse from the stream. Null = calm zero-state. */
export function deriveVerbPulse(
  verb: LoopVerb,
  rows: LoopEventRow[],
  nowMs: number = Date.now()
): VerbPulse | null {
  switch (verb) {
    case 'build':
      return buildPulse(rows, nowMs);
    case 'source':
      return sourcePulse(rows, nowMs);
    case 'run':
      return runPulse(rows, nowMs);
    case 'drive':
      return drivePulse(rows, nowMs);
  }
}
