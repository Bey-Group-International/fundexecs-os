import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeConviction, convictionDistribution, type ConvictionInput } from './conviction';

/* ----------------------------------------------------------------------------
 * Deal Conviction Index — pure-logic suite. Locks the invariants: weighted
 * composite, band thresholds, graceful handling of missing inputs (never NaN),
 * coverage cap, momentum decay, and the next-best lever.
 * -------------------------------------------------------------------------- */

const NOW = Date.parse('2026-06-14T00:00:00.000Z');

function deal(overrides: Partial<ConvictionInput> = {}): ConvictionInput {
  return {
    id: 'd1',
    name: 'Acme',
    stage: 'diligence',
    amount: 1_000_000,
    allocations: [],
    diligenceRuns: [],
    updatedAt: '2026-06-13T00:00:00.000Z', // 1 day ago
    ...overrides
  };
}

test('a strong deal scores High with all factors present', () => {
  const r = computeConviction(
    deal({
      stage: 'committed',
      diligenceRuns: [{ status: 'complete', conviction: 90 }],
      allocations: [{ amount: 1_000_000, status: 'accepted' }]
    }),
    NOW
  );
  assert.ok(r.score >= 75, `expected High, got ${r.score}`);
  assert.equal(r.band, 'High');
});

test('an empty early deal scores low and never NaN', () => {
  const r = computeConviction(
    deal({ stage: 'visitor', amount: null, updatedAt: '2026-01-01T00:00:00.000Z' }),
    NOW
  );
  assert.ok(Number.isFinite(r.score));
  assert.ok(r.score < 25, `expected Cold, got ${r.score}`);
  assert.equal(r.band, 'Cold');
});

test('weights sum to 1 and contributions sum to the score', () => {
  const r = computeConviction(
    deal({ diligenceRuns: [{ status: 'complete', conviction: 50 }] }),
    NOW
  );
  const w = r.factors.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(w - 1) < 1e-9);
  const sum = Math.round(r.factors.reduce((s, f) => s + f.contribution, 0));
  assert.equal(sum, r.score);
});

test('coverage is capped at 100 even when over-subscribed', () => {
  const r = computeConviction(
    deal({ amount: 500_000, allocations: [{ amount: 900_000, status: 'committed' }] }),
    NOW
  );
  const cov = r.factors.find((f) => f.key === 'coverage')!;
  assert.equal(cov.raw, 100);
});

test('non-committed allocation statuses do not count as coverage', () => {
  const r = computeConviction(
    deal({ amount: 1_000_000, allocations: [{ amount: 1_000_000, status: 'declined' }] }),
    NOW
  );
  assert.equal(r.factors.find((f) => f.key === 'coverage')!.raw, 0);
});

test('momentum decays with staleness', () => {
  const fresh = computeConviction(deal({ updatedAt: '2026-06-13T00:00:00.000Z' }), NOW);
  const stale = computeConviction(deal({ updatedAt: '2026-02-01T00:00:00.000Z' }), NOW);
  const fm = fresh.factors.find((f) => f.key === 'momentum')!.raw;
  const sm = stale.factors.find((f) => f.key === 'momentum')!.raw;
  assert.ok(fm > sm);
});

test('top lever points at the weakest weighted factor', () => {
  // Strong on everything except diligence (highest weight) → diligence is the lever.
  const r = computeConviction(
    deal({
      stage: 'committed',
      allocations: [{ amount: 1_000_000, status: 'accepted' }],
      diligenceRuns: []
    }),
    NOW
  );
  assert.match(r.topLever, /diligence/i);
});

test('distribution tallies bands', () => {
  const results = [
    computeConviction(
      deal({
        stage: 'committed',
        diligenceRuns: [{ status: 'complete', conviction: 95 }],
        allocations: [{ amount: 1_000_000, status: 'accepted' }]
      }),
      NOW
    ),
    computeConviction(
      deal({ stage: 'visitor', amount: null, updatedAt: '2026-01-01T00:00:00.000Z' }),
      NOW
    )
  ];
  const dist = convictionDistribution(results);
  assert.equal(dist.High + dist.Building + dist.Early + dist.Cold, 2);
});
