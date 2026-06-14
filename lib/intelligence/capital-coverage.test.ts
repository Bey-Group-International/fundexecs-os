import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapitalCoverage, type CoverageDealInput } from './capital-coverage';

/* ----------------------------------------------------------------------------
 * Capital Coverage & Concentration — pure-logic suite. Locks coverage %, the
 * per-stage exposure split, single-name / top-N concentration, HHI, and the
 * band thresholds.
 * -------------------------------------------------------------------------- */

function d(over: Partial<CoverageDealInput> & { id: string }): CoverageDealInput {
  return { name: over.id, stage: 'diligence', status: 'open', amount: 1_000_000, ...over };
}

test('coverage % is committed over pipeline value, rounded', () => {
  const r = computeCapitalCoverage([d({ id: 'a' })], 4_000_000, 1_000_000);
  assert.equal(r.coveragePct, 25);
  assert.equal(r.uncommitted, 3_000_000);
});

test('zero / missing pipeline value yields 0% coverage, never NaN', () => {
  const r = computeCapitalCoverage([d({ id: 'a' })], 0, 500_000);
  assert.equal(r.coveragePct, 0);
  assert.equal(r.uncommitted, 0);
});

test('closed and unsized deals are excluded from exposure', () => {
  const r = computeCapitalCoverage(
    [
      d({ id: 'live', amount: 2_000_000 }),
      d({ id: 'closed', amount: 5_000_000, status: 'closed' }),
      d({ id: 'unsized', amount: null })
    ],
    10_000_000,
    0
  );
  assert.equal(r.totalExposure, 2_000_000);
  assert.equal(r.sizedDeals, 1);
});

test('per-stage exposure splits by share and sorts largest first', () => {
  const r = computeCapitalCoverage(
    [
      d({ id: 'a', stage: 'diligence', amount: 3_000_000 }),
      d({ id: 'b', stage: 'meeting', amount: 1_000_000 })
    ],
    4_000_000,
    0
  );
  assert.equal(r.byStage[0].stage, 'diligence');
  assert.equal(r.byStage[0].share, 75);
  assert.equal(r.byStage[1].share, 25);
});

test('single-name and top-3 concentration are computed off live exposure', () => {
  const r = computeCapitalCoverage(
    [
      d({ id: 'big', name: 'Acme', amount: 6_000_000 }),
      d({ id: 'm', amount: 2_000_000 }),
      d({ id: 's', amount: 1_000_000 }),
      d({ id: 't', amount: 1_000_000 })
    ],
    10_000_000,
    0
  );
  assert.equal(r.topDeal?.dealName, 'Acme');
  assert.equal(r.topDeal?.share, 60);
  assert.equal(r.top3Share, 90); // 6M + 2M + 1M of 10M
});

test('a single dominant deal is Highly concentrated with max HHI', () => {
  const r = computeCapitalCoverage([d({ id: 'only', amount: 5_000_000 })], 5_000_000, 0);
  assert.equal(r.band, 'Highly concentrated');
  assert.equal(r.hhi, 10000);
});

test('an evenly spread book is Diversified', () => {
  const deals = Array.from({ length: 10 }, (_, i) => d({ id: `x${i}`, amount: 1_000_000 }));
  const r = computeCapitalCoverage(deals, 10_000_000, 0);
  assert.equal(r.band, 'Diversified');
  assert.equal(r.topDeal?.share, 10);
  assert.equal(r.hhi, 1000); // 10 × (0.1)² × 10000
});

test('empty pipeline yields a safe, headlined zero state', () => {
  const r = computeCapitalCoverage([], 0, 0);
  assert.equal(r.totalExposure, 0);
  assert.equal(r.topDeal, null);
  assert.equal(r.band, 'Diversified');
  assert.match(r.headline, /No sized deals/);
});
