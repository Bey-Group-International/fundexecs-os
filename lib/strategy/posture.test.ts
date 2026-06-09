import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePosture,
  complianceLaneScore,
  POSTURE_WEIGHTS,
  POSTURE_LANE_ORDER
} from './posture';

test('weights sum to 100', () => {
  const sum = Object.values(POSTURE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('all-100 inputs yield a 100 composite', () => {
  const r = computePosture({ compliance: 100, governance: 100, execution: 100, capital: 100 });
  assert.equal(r.score, 100);
  assert.equal(r.lanes.length, 4);
});

test('all-zero inputs yield a 0 composite', () => {
  const r = computePosture({ compliance: 0, governance: 0, execution: 0, capital: 0 });
  assert.equal(r.score, 0);
});

test('composite is the weighted blend of the lanes', () => {
  // compliance 100 (30) + others 0 → 30.
  const r = computePosture({ compliance: 100, governance: 0, execution: 0, capital: 0 });
  assert.equal(r.score, 30);
});

test('lanes come back in display order with labels + weights', () => {
  const r = computePosture({ compliance: 50, governance: 50, execution: 50, capital: 50 });
  assert.deepEqual(
    r.lanes.map((l) => l.key),
    [...POSTURE_LANE_ORDER]
  );
  assert.equal(r.lanes[0].label, 'Compliance');
  assert.equal(r.lanes[0].weight, POSTURE_WEIGHTS.compliance);
  assert.equal(r.score, 50);
});

test('out-of-range and non-finite inputs are clamped', () => {
  const r = computePosture({
    compliance: 150,
    governance: -20,
    execution: Number.NaN,
    capital: 50
  });
  assert.equal(r.lanes[0].score, 100); // 150 → 100
  assert.equal(r.lanes[1].score, 0); // -20 → 0
  assert.equal(r.lanes[2].score, 0); // NaN → 0
  assert.equal(r.lanes[3].score, 50);
});

test('compliance lane: no items = fully clear (100)', () => {
  assert.equal(complianceLaneScore({ doneLive: 0, openLive: 0, pendingDrafts: 0 }), 100);
});

test('compliance lane: all pending drafts = 0', () => {
  assert.equal(complianceLaneScore({ doneLive: 0, openLive: 0, pendingDrafts: 10 }), 0);
});

test('compliance lane: open (approved) counts half, done counts full', () => {
  // 2 done + 2 open(×0.5) = 3 of 6 → 50.
  assert.equal(complianceLaneScore({ doneLive: 2, openLive: 2, pendingDrafts: 2 }), 50);
});
