import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePostureMomentum,
  computePeerPercentile,
  PEER_COHORT_FLOOR,
  type PostureSnapshot
} from './posture-trend';

const snap = (date: string, composite: number): PostureSnapshot => ({ date, composite });

test('momentum is null when there are no snapshots (never fabricated)', () => {
  assert.equal(computePostureMomentum([]), null);
});

test('a single snapshot yields delta 0, flat, streak 1', () => {
  const m = computePostureMomentum([snap('2026-06-01', 60)]);
  assert.deepEqual(m, { current: 60, delta: 0, direction: 'flat', streak: 1 });
});

test('delta is latest minus the immediately prior snapshot', () => {
  const m = computePostureMomentum([snap('2026-06-01', 50), snap('2026-06-08', 62)]);
  assert.equal(m?.current, 62);
  assert.equal(m?.delta, 12);
  assert.equal(m?.direction, 'up');
});

test('a fall sets direction down and breaks the streak', () => {
  const m = computePostureMomentum([snap('2026-06-01', 70), snap('2026-06-08', 60)]);
  assert.equal(m?.delta, -10);
  assert.equal(m?.direction, 'down');
  assert.equal(m?.streak, 1);
});

test('streak counts consecutive held-or-improved snapshots from the latest', () => {
  // 40 → 50 → 50 → 65: all held or rose, so streak spans all four points.
  const m = computePostureMomentum([
    snap('2026-06-01', 40),
    snap('2026-06-02', 50),
    snap('2026-06-03', 50),
    snap('2026-06-04', 65)
  ]);
  assert.equal(m?.streak, 4);
  assert.equal(m?.delta, 15);
});

test('streak stops at the first drop walking back from latest', () => {
  // oldest→newest: 80, 50, 60, 70 — the 80→50 drop caps the streak at 3.
  const m = computePostureMomentum([
    snap('2026-06-01', 80),
    snap('2026-06-02', 50),
    snap('2026-06-03', 60),
    snap('2026-06-04', 70)
  ]);
  assert.equal(m?.streak, 3);
});

test('momentum is order-independent (sorts by date internally)', () => {
  const shuffled = computePostureMomentum([snap('2026-06-08', 62), snap('2026-06-01', 50)]);
  assert.equal(shuffled?.current, 62);
  assert.equal(shuffled?.delta, 12);
});

test('peer percentile is null below the privacy floor', () => {
  // cohort incl. this org = 4 (3 peers + 1) < floor of 5.
  assert.equal(computePeerPercentile(70, [60, 65, 80]), null);
});

test('peer percentile resolves once the cohort clears the floor', () => {
  // 4 peers + this org = 5 = floor. This org (70) is at-or-above 2 peers + itself
  // = 3 of 5 → 60th percentile.
  const p = computePeerPercentile(70, [50, 60, 80, 90]);
  assert.ok(p);
  assert.equal(p?.cohortSize, 5);
  assert.equal(p?.percentile, 60);
});

test('top of cohort reads 100th percentile', () => {
  const p = computePeerPercentile(99, [10, 20, 30, 40]);
  assert.equal(p?.percentile, 100);
});

test('strict bottom of cohort reads low but never fabricates', () => {
  // This org (5) is at-or-below none of the peers → only itself = 1 of 5 = 20.
  const p = computePeerPercentile(5, [10, 20, 30, 40]);
  assert.equal(p?.percentile, 20);
});

test('PEER_COHORT_FLOOR is the documented privacy floor of 5', () => {
  assert.equal(PEER_COHORT_FLOOR, 5);
});

test('a custom floor is honored', () => {
  // 2 peers + this org = 3; passes a floor of 3 but not the default 5.
  assert.equal(computePeerPercentile(50, [40, 60]), null);
  assert.ok(computePeerPercentile(50, [40, 60], 3));
});
