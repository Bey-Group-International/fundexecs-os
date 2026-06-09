import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READINESS_WEIGHTS,
  type ReadinessDimension,
  type ReadinessDimensionScore
} from './lifecycle';
import {
  INSTITUTIONAL_BAR,
  computeCompoundReadiness,
  computeReadinessValue,
  projectTrajectory,
  projectValue,
  rankByValue
} from './readiness';

const ORDER: ReadinessDimension[] = ['profile', 'proof', 'materials', 'pipeline', 'capital'];

/** Build a breakdown from a partial score map (missing dims default to 0). */
function bd(scores: Partial<Record<ReadinessDimension, number>>): ReadinessDimensionScore[] {
  return ORDER.map((dimension) => {
    const score = scores[dimension] ?? 0;
    const weight = READINESS_WEIGHTS[dimension];
    return { dimension, score, weight, contribution: (score * weight) / 100 };
  });
}

const ALL = (n: number) => bd({ profile: n, proof: n, materials: n, pipeline: n, capital: n });

/* ── base vs compound ──────────────────────────────────────────────────── */

test('baseScore equals the flat weighted average', () => {
  // Weights sum to 100, so an even score round-trips to itself.
  assert.equal(computeCompoundReadiness(ALL(60)).baseScore, 60);
  assert.equal(computeCompoundReadiness(ALL(0)).baseScore, 0);
  assert.equal(computeCompoundReadiness(ALL(100)).baseScore, 100);
});

test('all-zero is safe: no NaN, neutral multiplier', () => {
  const c = computeCompoundReadiness(ALL(0));
  assert.equal(c.compoundScore, 0);
  assert.equal(c.multiplier, 1);
  assert.ok(Number.isFinite(c.synergy));
});

/* ── synergy ───────────────────────────────────────────────────────────── */

test('synergy is driven only by the foundation (Profile + Proof)', () => {
  // Full foundation → no execution discount.
  assert.equal(computeCompoundReadiness(bd({ profile: 100, proof: 100 })).synergy, 1);
  // Empty foundation → execution counts at the 0.7 floor.
  assert.equal(
    computeCompoundReadiness(bd({ materials: 100, pipeline: 100, capital: 100 })).synergy,
    0.7
  );
});

test('weak foundation discounts execution-heavy systems below their flat score', () => {
  // High execution, no foundation: synergy haircut pulls compound under base.
  const c = computeCompoundReadiness(bd({ materials: 100, pipeline: 100, capital: 100 }));
  assert.ok(c.compoundScore < c.baseScore, `${c.compoundScore} should be < ${c.baseScore}`);
  assert.ok(c.multiplier < 1);
});

/* ── balance bonus ─────────────────────────────────────────────────────── */

test('balance bonus is zero until the weakest link clears the floor', () => {
  // Weakest exactly at the floor (40) does not qualify (strict >).
  assert.equal(
    computeCompoundReadiness(
      bd({ profile: 40, proof: 100, materials: 100, pipeline: 100, capital: 100 })
    ).balanceBonus,
    0
  );
  // A full, balanced system earns the maximum bonus.
  assert.equal(computeCompoundReadiness(ALL(100)).balanceBonus, 8);
});

test('a balanced system reinforces (multiplier > 1)', () => {
  const c = computeCompoundReadiness(ALL(80));
  assert.ok(c.multiplier > 1, `expected reinforcing, got ${c.multiplier}`);
  assert.ok(c.compoundScore > c.baseScore);
});

/* ── weakest link ──────────────────────────────────────────────────────── */

test('weakestLink points at the lowest dimension', () => {
  assert.equal(
    computeCompoundReadiness(
      bd({ profile: 30, proof: 90, materials: 90, pipeline: 90, capital: 90 })
    ).weakestLink,
    'profile'
  );
  assert.equal(
    computeCompoundReadiness(
      bd({ profile: 90, proof: 90, materials: 90, pipeline: 90, capital: 20 })
    ).weakestLink,
    'capital'
  );
});

/* ── value translation ─────────────────────────────────────────────────── */

test('projectValue is linear in the score and guards a missing target', () => {
  assert.equal(projectValue(1_000_000, 50), 500_000);
  assert.equal(projectValue(1_000_000, 0), 0);
  assert.equal(projectValue(0, 80), 0);
  assert.equal(projectValue(-5, 80), 0);
});

test('readiness value prices the gap and the locked remainder', () => {
  const c = computeCompoundReadiness(ALL(50));
  const v = computeReadinessValue(c, 1_000_000);
  assert.equal(v.projected, projectValue(1_000_000, c.compoundScore));
  assert.equal(v.locked, 1_000_000 - v.projected);
  // Every dimension has a (non-negative) dollar unlock.
  for (const d of ORDER) assert.ok(v.unlockByDimension[d] >= 0);
});

test('no target → zero projected, locked, and unlocks', () => {
  const c = computeCompoundReadiness(ALL(50));
  const v = computeReadinessValue(c, 0);
  assert.equal(v.projected, 0);
  assert.equal(v.locked, 0);
  for (const d of ORDER) assert.equal(v.unlockByDimension[d], 0);
});

/* ── ranking ───────────────────────────────────────────────────────────── */

test('rankByValue returns all five, sorted by value-per-point', () => {
  const c = computeCompoundReadiness(
    bd({ profile: 30, proof: 40, materials: 60, pipeline: 70, capital: 50 })
  );
  const ranked = rankByValue(c, computeReadinessValue(c, 5_000_000));
  assert.equal(ranked.length, 5);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(
      ranked[i - 1].valuePerPoint >= ranked[i].valuePerPoint,
      'ranked descending by valuePerPoint'
    );
  }
  // It is a permutation of the five dimensions.
  assert.deepEqual([...ranked.map((r) => r.dimension)].sort(), [...ORDER].sort());
});

test('with no target, ranking falls back to compound lift then gap', () => {
  const c = computeCompoundReadiness(
    bd({ profile: 30, proof: 40, materials: 60, pipeline: 70, capital: 50 })
  );
  const ranked = rankByValue(c, computeReadinessValue(c, 0));
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1];
    const b = ranked[i];
    assert.ok(a.lift > b.lift || (a.lift === b.lift && a.gap >= b.gap));
  }
});

/* ── trajectory ────────────────────────────────────────────────────────── */

test('trajectory starts at today and never decreases or exceeds 100', () => {
  const breakdown = bd({ profile: 50, proof: 45, materials: 30, pipeline: 40, capital: 20 });
  const today = computeCompoundReadiness(breakdown).compoundScore;
  const traj = projectTrajectory(breakdown, 2_000_000);

  assert.equal(traj.points[0].week, 0);
  assert.equal(traj.points[0].score, today);
  for (let i = 1; i < traj.points.length; i++) {
    assert.ok(traj.points[i].score >= traj.points[i - 1].score, 'monotonic non-decreasing');
    assert.ok(traj.points[i].score <= 100);
  }
});

test('trajectory reports when it crosses the institutional bar', () => {
  // Already over the bar → crosses at week 0.
  const over = projectTrajectory(ALL(90), 1_000_000);
  assert.equal(over.weeksToBar, 0);

  // Below the bar but climbing → first crossing point is actually at/over the bar.
  const climbing = projectTrajectory(ALL(50), 1_000_000);
  if (climbing.weeksToBar !== null) {
    assert.ok(climbing.points[climbing.weeksToBar].score >= INSTITUTIONAL_BAR);
    // …and the prior week was below it.
    if (climbing.weeksToBar > 0) {
      assert.ok(climbing.points[climbing.weeksToBar - 1].score < INSTITUTIONAL_BAR);
    }
  }
});

test('trajectory projected capital tracks the score against the target', () => {
  const traj = projectTrajectory(ALL(60), 1_000_000);
  for (const p of traj.points) {
    assert.equal(p.projected, projectValue(1_000_000, p.score));
  }
});

test('INSTITUTIONAL_BAR is a sane 0–100 threshold', () => {
  assert.ok(INSTITUTIONAL_BAR > 0 && INSTITUTIONAL_BAR <= 100);
});
