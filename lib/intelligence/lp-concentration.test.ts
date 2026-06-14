import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLpConcentration, type LpCommitment } from './lp-concentration';

/* ----------------------------------------------------------------------------
 * LP Concentration & Commitment Health — pure-logic suite. Locks aggregation,
 * per-LP share, top-N, HHI, and the band thresholds.
 * -------------------------------------------------------------------------- */

const lp = (id: string, amount: number | null, name = id): LpCommitment => ({
  lpId: id,
  lpName: name,
  amount
});

test('commitments are aggregated per LP and shares sum off the total', () => {
  const r = computeLpConcentration([lp('a', 3_000_000), lp('a', 1_000_000), lp('b', 1_000_000)]);
  assert.equal(r.totalCommitted, 5_000_000);
  assert.equal(r.lpCount, 2);
  assert.equal(r.topLp?.lpId, 'a');
  assert.equal(r.topLp?.amount, 4_000_000);
  assert.equal(r.topLp?.share, 80);
});

test('null / non-positive amounts are ignored', () => {
  const r = computeLpConcentration([lp('a', 2_000_000), lp('b', null), lp('c', 0), lp('d', -5)]);
  assert.equal(r.totalCommitted, 2_000_000);
  assert.equal(r.lpCount, 1);
});

test('a dominant single LP is Single-anchor with high HHI', () => {
  const r = computeLpConcentration([lp('whale', 9_000_000), lp('minnow', 1_000_000)]);
  assert.equal(r.band, 'Single-anchor');
  assert.equal(r.topLp?.share, 90);
  assert.equal(r.hhi, 8200); // 0.9² + 0.1² = 0.82 → 8200
});

test('an evenly spread base is Diversified', () => {
  const commitments = Array.from({ length: 10 }, (_, i) => lp(`x${i}`, 1_000_000));
  const r = computeLpConcentration(commitments);
  assert.equal(r.band, 'Diversified');
  assert.equal(r.topLp?.share, 10);
  assert.equal(r.hhi, 1000);
  assert.match(r.headline, /diversified across 10 LPs/);
});

test('top-3 share is the combined share of the three largest LPs', () => {
  const r = computeLpConcentration([
    lp('a', 5_000_000),
    lp('b', 2_000_000),
    lp('c', 2_000_000),
    lp('d', 1_000_000)
  ]);
  assert.equal(r.top3Share, 90); // (5+2+2)/10
});

test('empty base is a safe, headlined zero state', () => {
  const r = computeLpConcentration([]);
  assert.equal(r.totalCommitted, 0);
  assert.equal(r.lpCount, 0);
  assert.equal(r.topLp, null);
  assert.equal(r.band, 'Diversified');
  assert.match(r.headline, /No committed LPs/);
});
