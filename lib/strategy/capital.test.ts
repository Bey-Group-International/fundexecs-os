import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIORITY_WEIGHT, capitalWeightOf, weightedCompletion, isPendingDraft } from './capital';

test('capitalWeightOf uses the linked dollar value when positive', () => {
  assert.equal(capitalWeightOf({ priority: 'Low', capitalWeight: 250000 }), 250000);
});

test('capitalWeightOf falls back to the priority proxy when no link', () => {
  assert.equal(capitalWeightOf({ priority: 'High' }), PRIORITY_WEIGHT.High);
  assert.equal(
    capitalWeightOf({ priority: 'Medium', capitalWeight: null }),
    PRIORITY_WEIGHT.Medium
  );
});

test('capitalWeightOf rejects zero / negative / NaN and falls back to proxy', () => {
  assert.equal(capitalWeightOf({ priority: 'Low', capitalWeight: 0 }), PRIORITY_WEIGHT.Low);
  assert.equal(capitalWeightOf({ priority: 'High', capitalWeight: -5 }), PRIORITY_WEIGHT.High);
  assert.equal(capitalWeightOf({ priority: 'Medium', capitalWeight: NaN }), PRIORITY_WEIGHT.Medium);
});

test('weightedCompletion is 0 for an empty plan', () => {
  assert.equal(weightedCompletion([]), 0);
});

test('weightedCompletion reduces to a plain mean when weights are equal', () => {
  const list = [
    { priority: 'Medium' as const, pct: 100 },
    { priority: 'Medium' as const, pct: 0 }
  ];
  assert.equal(weightedCompletion(list), 50);
});

test('weightedCompletion tilts toward higher-priority objectives', () => {
  // High(3)*100 + Low(1)*0 = 300 / 4 = 75
  const list = [
    { priority: 'High' as const, pct: 100 },
    { priority: 'Low' as const, pct: 0 }
  ];
  assert.equal(weightedCompletion(list), 75);
});

test('weightedCompletion lets a real dollar weight dominate the proxy', () => {
  // 1,000,000 * 100 + Low(1) * 0  ≈ 100
  const list = [
    { priority: 'Low' as const, capitalWeight: 1_000_000, pct: 100 },
    { priority: 'Low' as const, pct: 0 }
  ];
  assert.equal(weightedCompletion(list), 100);
});

test('isPendingDraft: a non-manual, unapproved objective is pending', () => {
  assert.equal(isPendingDraft({ source: 'lifecycle', approved: false }), true);
  assert.equal(isPendingDraft({ source: 'signal', approved: false }), true);
  assert.equal(isPendingDraft({ source: 'cascade', approved: false }), true);
});

test('isPendingDraft: manual objectives are always live', () => {
  assert.equal(isPendingDraft({ source: 'manual', approved: false }), false);
  assert.equal(isPendingDraft({ source: 'manual', approved: true }), false);
});

test('isPendingDraft: approved drafts are live', () => {
  assert.equal(isPendingDraft({ source: 'lifecycle', approved: true }), false);
});

test('isPendingDraft: pre-migration rows (no source) are treated as live', () => {
  assert.equal(isPendingDraft({ approved: true }), false);
  assert.equal(isPendingDraft({ source: null, approved: false }), false);
});
