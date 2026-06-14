import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeConversion, type StageCount } from './conversion';

/* ----------------------------------------------------------------------------
 * Pipeline Conversion Analytics — pure-logic suite. Locks cumulative reach,
 * stage-to-stage conversion, the biggest-leak detector, and the overall rate.
 * -------------------------------------------------------------------------- */

const STAGES = (counts: number[]): StageCount[] =>
  [
    'visitor',
    'prospect',
    'qualified',
    'meeting',
    'diligence',
    'soft-circle',
    'committed',
    'closed'
  ].map((key, i) => ({ key, label: key, count: counts[i] ?? 0 }));

test('reach is cumulative at-or-past each stage', () => {
  // 4 visitor, 3 prospect, 2 qualified, then 0…
  const r = computeConversion(STAGES([4, 3, 2]));
  assert.equal(r.stages[0].reached, 9); // 4+3+2
  assert.equal(r.stages[1].reached, 5); // 3+2
  assert.equal(r.stages[2].reached, 2);
  assert.equal(r.totalDeals, 9);
});

test('conversionFromPrev is reach[i]/reach[i-1]; entry stage is 100%', () => {
  const r = computeConversion(STAGES([4, 3, 2]));
  assert.equal(r.stages[0].conversionFromPrev, 100);
  assert.equal(r.stages[1].conversionFromPrev, 56); // 5/9
  assert.equal(r.stages[2].conversionFromPrev, 40); // 2/5
  assert.equal(r.stages[1].dropOff, 44);
});

test('biggest leak is the steepest transition that lost deals', () => {
  // big drop visitor(10)->prospect(reach 3): 30%
  const r = computeConversion(STAGES([7, 1, 1, 1]));
  assert.ok(r.biggestLeak);
  assert.equal(r.biggestLeak?.fromLabel, 'visitor');
  assert.equal(r.biggestLeak?.toLabel, 'prospect');
  assert.equal(r.biggestLeak?.conversionPct, 30); // reach 3 of 10
  assert.equal(r.biggestLeak?.lost, 7);
});

test('overall conversion is committed-or-beyond over entered', () => {
  // committed index 6, closed index 7
  const counts = [2, 0, 0, 0, 0, 0, 1, 1]; // total 4, committed-reach = 2
  const r = computeConversion(STAGES(counts));
  assert.equal(r.totalDeals, 4);
  assert.equal(r.overallConversionPct, 50); // 2 of 4
});

test('a perfect funnel (all deals at the terminal stage) has no leak', () => {
  const r = computeConversion(STAGES([0, 0, 0, 0, 0, 0, 0, 5]));
  assert.equal(r.biggestLeak, null);
  assert.equal(r.overallConversionPct, 100); // committed-reach includes closed
});

test('empty funnel is safe and headlined', () => {
  const r = computeConversion(STAGES([]));
  assert.equal(r.totalDeals, 0);
  assert.equal(r.overallConversionPct, 0);
  assert.equal(r.biggestLeak, null);
  assert.match(r.headline, /No deals/);
});

test('never produces NaN when an upstream stage is empty', () => {
  const r = computeConversion(STAGES([0, 0, 3]));
  for (const s of r.stages) {
    assert.ok(Number.isFinite(s.conversionFromPrev));
    assert.ok(s.conversionFromPrev >= 0 && s.conversionFromPrev <= 100);
  }
});
