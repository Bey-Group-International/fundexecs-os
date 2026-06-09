import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveObjectivePct,
  isPendingDraft,
  childTier,
  computeCascadeChildren,
  detectGateUnlock,
  type ObjectiveProgressInput
} from './compounding';
import type { LifecycleStage } from '@/lib/lifecycle';

const baseTrust = { truth: 0, concept: 0, execution: 0, work: 0 };

/* ---- deriveObjectivePct -------------------------------------------------- */

test('done objective is always 100', () => {
  assert.equal(deriveObjectivePct({ state: 'done', status: 'open', trust: baseTrust }), 100);
});

test('ungrounded open objective falls back to legacy status mapping', () => {
  assert.equal(deriveObjectivePct({ state: 'open', status: 'open' }), 0);
  assert.equal(deriveObjectivePct({ state: 'open', status: 'in_progress' }), 50);
});

test('cleared stage gate makes an open objective read as delivered (100)', () => {
  const input: ObjectiveProgressInput = {
    state: 'open',
    status: 'open',
    lifecycleStage: 'source_lps',
    gatesCleared: { source_lps: true }
  };
  assert.equal(deriveObjectivePct(input), 100);
});

test('uncleared stage gate uses loop progress as a soft floor', () => {
  const input: ObjectiveProgressInput = {
    state: 'open',
    status: 'open',
    lifecycleStage: 'source_lps',
    gatesCleared: { source_lps: false },
    loopProgress: 40
  };
  assert.equal(deriveObjectivePct(input), 40);
});

test('trust layer drives pct by category (governance → concept layer)', () => {
  const input: ObjectiveProgressInput = {
    state: 'open',
    status: 'open',
    category: 'governance',
    trust: { ...baseTrust, concept: 60 }
  };
  assert.equal(deriveObjectivePct(input), 60);
});

test('lifecycle + trust signals are averaged', () => {
  // loopProgress 20 (uncleared gate) + execution trust 80, category execution → (20+80)/2 = 50
  const input: ObjectiveProgressInput = {
    state: 'open',
    status: 'open',
    category: 'execution',
    lifecycleStage: 'operate',
    gatesCleared: { operate: false },
    loopProgress: 20,
    trust: { ...baseTrust, execution: 80 }
  };
  assert.equal(deriveObjectivePct(input), 50);
});

test('in-progress status floors a low signal at 50', () => {
  const input: ObjectiveProgressInput = {
    state: 'open',
    status: 'in_progress',
    lifecycleStage: 'source_lps',
    gatesCleared: { source_lps: false },
    loopProgress: 10
  };
  // mean signal is 10, but in-progress floors to 50
  assert.equal(deriveObjectivePct(input), 50);
});

test('legacy active status floors a low signal at 50', () => {
  const input: ObjectiveProgressInput = {
    state: 'open',
    status: 'active',
    lifecycleStage: 'source_lps',
    gatesCleared: { source_lps: false },
    loopProgress: 10
  };
  // mean signal is 10, but a legacy 'active' status floors to 50
  assert.equal(deriveObjectivePct(input), 50);
});

/* ---- isPendingDraft ------------------------------------------------------ */

test('approved objective is never a draft', () => {
  assert.equal(isPendingDraft({ approvedAt: '2026-06-09T00:00:00Z', source: 'signal' }), false);
});

test('unapproved manual objective is not a draft (legacy path)', () => {
  assert.equal(isPendingDraft({ approvedAt: null, source: 'manual' }), false);
});

test('unapproved signal/cascade objective is a pending draft', () => {
  assert.equal(isPendingDraft({ approvedAt: null, source: 'signal' }), true);
  assert.equal(isPendingDraft({ approvedAt: null, source: 'cascade' }), true);
});

/* ---- cascade ------------------------------------------------------------- */

test('childTier walks 100 → 30 → 10 → null', () => {
  assert.equal(childTier('100'), '30');
  assert.equal(childTier('30'), '10');
  assert.equal(childTier('10'), null);
});

test('completing a 100 spawns one 30-day child inheriting category/stage', () => {
  const kids = computeCascadeChildren({
    tier: '100',
    title: 'Close the first institutional LP',
    category: 'capital',
    lifecycleStage: 'convert_lps'
  });
  assert.equal(kids.length, 1);
  assert.equal(kids[0].tier, '30');
  assert.equal(kids[0].timeline, '30 days');
  assert.equal(kids[0].category, 'capital');
  assert.equal(kids[0].lifecycleStage, 'convert_lps');
  assert.match(kids[0].objective, /Advance/);
});

test('completing a 30 spawns one 10-day move', () => {
  const kids = computeCascadeChildren({ tier: '30', title: 'Draft the LP one-pager' });
  assert.equal(kids.length, 1);
  assert.equal(kids[0].tier, '10');
  assert.match(kids[0].objective, /Execute/);
});

test('completing a 10-day move is a leaf (no cascade)', () => {
  assert.deepEqual(computeCascadeChildren({ tier: '10', title: 'Send the email' }), []);
});

/* ---- gate-unlock --------------------------------------------------------- */

const allFalse: Record<LifecycleStage, boolean> = {
  establish_truth: false,
  get_raise_ready: false,
  source_lps: false,
  convert_lps: false,
  source_deals: false,
  operate: false,
  prove: false
};

test('no gate change → no unlock', () => {
  assert.equal(detectGateUnlock(allFalse, allFalse), null);
});

test('a newly-cleared gate surfaces the unlocked next stage', () => {
  const before = { ...allFalse };
  const after = { ...allFalse, establish_truth: true };
  const unlock = detectGateUnlock(before, after);
  assert.ok(unlock);
  assert.equal(unlock!.clearedStage, 'establish_truth');
  assert.equal(unlock!.unlockedStage, 'get_raise_ready');
  assert.equal(unlock!.unlockedLabel, 'Get raise-ready');
  assert.match(unlock!.message, /unlocks/);
});

test('detects the earliest newly-cleared gate in loop order', () => {
  const before = { ...allFalse, establish_truth: true };
  const after = { ...allFalse, establish_truth: true, get_raise_ready: true, source_lps: true };
  const unlock = detectGateUnlock(before, after);
  assert.ok(unlock);
  assert.equal(unlock!.clearedStage, 'get_raise_ready');
  assert.equal(unlock!.unlockedStage, 'source_lps');
});

test('an already-cleared gate is not re-reported', () => {
  const before = { ...allFalse, establish_truth: true };
  const after = { ...allFalse, establish_truth: true };
  assert.equal(detectGateUnlock(before, after), null);
});
