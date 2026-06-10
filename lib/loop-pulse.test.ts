import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoopVerb } from './loop-chain';
import { PULSE_WINDOW_DAYS, deriveVerbPulse, type LoopEventRow } from './loop-pulse';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-06-10T12:00:00Z');

/** A row `daysAgo` days before NOW. */
function row(
  verb: LoopVerb,
  eventType: string,
  daysAgo: number,
  metadata: Record<string, unknown> = {},
  entityId: string | null = null
): LoopEventRow {
  return {
    verb,
    eventType,
    entityId,
    createdAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    metadata
  };
}

/* ── zero-states ───────────────────────────────────────────────────────── */

test('every verb derives null from an empty stream — calm zero-state', () => {
  for (const verb of ['build', 'source', 'run', 'drive'] as const) {
    assert.equal(deriveVerbPulse(verb, [], NOW), null);
  }
});

test('events outside the window do not count', () => {
  const old = [row('source', 'deal_created', PULSE_WINDOW_DAYS + 1, { amount: 100 })];
  assert.equal(deriveVerbPulse('source', old, NOW), null);
});

/* ── source ────────────────────────────────────────────────────────────── */

test('source counts deals sourced and sums their dollars', () => {
  const rows = [
    row('source', 'deal_created', 2, { amount: 1_000_000 }),
    row('source', 'deal_created', 5, { amount: 500_000 }),
    // A stage move is not a sourced deal.
    row('source', 'deal_stage', 1, { stage: 'qualified' })
  ];
  const pulse = deriveVerbPulse('source', rows, NOW);
  assert.equal(pulse?.headline, '2 deals sourced · $1.5M');
  assert.match(pulse?.detail ?? '', /last 30 days/);
});

test('source omits dollars when no amounts were carried', () => {
  const pulse = deriveVerbPulse('source', [row('source', 'deal_created', 1)], NOW);
  assert.equal(pulse?.headline, '1 deal sourced');
});

/* ── run ───────────────────────────────────────────────────────────────── */

test('run counts decisions and derives median days-to-decide from stage pairing', () => {
  const rows = [
    // Deal A entered diligence 10d ago, decided 2d ago → 8d.
    row('run', 'deal_stage', 10, { stage: 'diligence' }, 'deal-a'),
    row('run', 'loop_closed', 2, { dealId: 'deal-a', credited: true }),
    // Deal B entered diligence 5d ago, decided 1d ago → 4d.
    row('run', 'deal_stage', 5, { stage: 'diligence' }, 'deal-b'),
    row('run', 'loop_closed', 1, { dealId: 'deal-b', credited: true })
  ];
  const pulse = deriveVerbPulse('run', rows, NOW);
  assert.equal(pulse?.headline, '2 decisions');
  // Median of 8 and 4 → 6.
  assert.match(pulse?.detail ?? '', /median 6d to decide/);
});

test('run still reports decisions when no stage pairing exists', () => {
  const pulse = deriveVerbPulse('run', [row('run', 'loop_closed', 1)], NOW);
  assert.equal(pulse?.headline, '1 decision');
  assert.equal(pulse?.detail, 'last 30 days');
});

/* ── drive ─────────────────────────────────────────────────────────────── */

test('drive counts closes and sums dollars closed', () => {
  const rows = [
    row('drive', 'loop_closed', 3, { amount: 2_000_000, credited: true }),
    row('drive', 'loop_closed', 9, { amount: 500_000, credited: false }),
    // A run decision is not a drive close.
    row('run', 'loop_closed', 1, { amount: 999 })
  ];
  const pulse = deriveVerbPulse('drive', rows, NOW);
  assert.equal(pulse?.headline, '2 closes · $2.5M');
});

/* ── build ─────────────────────────────────────────────────────────────── */

test('build counts credited loop closes across verbs — the flywheel, visible', () => {
  const rows = [
    row('run', 'loop_closed', 2, { credited: true }),
    row('drive', 'loop_closed', 4, { credited: true }),
    // Uncredited replays do not compound the record.
    row('drive', 'loop_closed', 5, { credited: false })
  ];
  const pulse = deriveVerbPulse('build', rows, NOW);
  assert.equal(pulse?.headline, '2 proof credits');
  assert.match(pulse?.detail ?? '', /compounding into your record/);
});
