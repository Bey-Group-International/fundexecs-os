import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LP_STAGES, lpValue, nextLpStage, normalizeLpStage } from './lp-stages';

test('LP_STAGES carries the prototype labels over the canonical keys', () => {
  assert.deepEqual(
    LP_STAGES.map((s) => s.label),
    ['Target', 'Contacted', 'Soft-circled', 'Committed']
  );
  assert.deepEqual(
    LP_STAGES.map((s) => s.key),
    ['prospect', 'contacted', 'soft_circled', 'committed']
  );
});

test('normalizeLpStage maps free-form statuses to canonical stages', () => {
  assert.equal(normalizeLpStage('prospect'), 'prospect');
  assert.equal(normalizeLpStage('Contacted'), 'contacted');
  assert.equal(normalizeLpStage('intro requested'), 'contacted');
  assert.equal(normalizeLpStage('soft-circled'), 'soft_circled');
  assert.equal(normalizeLpStage('Committed'), 'committed');
  assert.equal(normalizeLpStage('closed/won'), 'committed');
  assert.equal(normalizeLpStage('passed'), 'passed');
  assert.equal(normalizeLpStage('declined'), 'passed');
  assert.equal(normalizeLpStage(''), 'prospect');
  assert.equal(normalizeLpStage(null), 'prospect');
});

test('nextLpStage advances exactly one stage and is terminal at committed', () => {
  assert.equal(nextLpStage('prospect'), 'contacted');
  assert.equal(nextLpStage('contacted'), 'soft_circled');
  assert.equal(nextLpStage('soft_circled'), 'committed');
  assert.equal(nextLpStage('committed'), null);
});

test('lpValue is the range midpoint, or whichever bound exists', () => {
  assert.equal(lpValue(5_000_000, 10_000_000), 7_500_000);
  assert.equal(lpValue(null, 10_000_000), 10_000_000);
  assert.equal(lpValue(5_000_000, null), 5_000_000);
  assert.equal(lpValue(null, null), 0);
});
