import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EX_CLOSE_META,
  EX_CLOSINGS,
  closingProgress,
  closingStepsCopy,
  executeStep,
  isStepDone,
  nextStepIndex,
  stepRunSteps,
  stepStatusMeta
} from './config';

test('every close in the meta exists with valid step statuses', () => {
  for (const meta of EX_CLOSE_META) {
    const closing = EX_CLOSINGS[meta.id];
    assert.ok(closing, `missing closing ${meta.id}`);
    assert.ok(closing.steps.length > 0, `${meta.id} has no steps`);
    for (const s of closing.steps) {
      assert.ok(['pending', 'ready', 'signed', 'wired'].includes(s.status), `${meta.id}.${s.id}`);
    }
    // Exactly one step starts ready (the entry point), the rest pending.
    assert.equal(closing.steps.filter((s) => s.status === 'ready').length, 1);
  }
});

test('closingStepsCopy is a detached copy', () => {
  const steps = closingStepsCopy(EX_CLOSINGS.helios);
  steps[0].status = 'signed';
  assert.equal(EX_CLOSINGS.helios.steps[0].status, 'ready');
});

test('a fresh closing starts at step 0 with 0% progress', () => {
  const steps = closingStepsCopy(EX_CLOSINGS.helios);
  assert.equal(nextStepIndex(steps), 0);
  const p = closingProgress(steps);
  assert.equal(p.done, 0);
  assert.equal(p.pct, 0);
  assert.equal(p.closed, false);
});

test('executeStep marks the step done and arms the next pending step', () => {
  const steps = closingStepsCopy(EX_CLOSINGS.helios);
  const next = executeStep(steps, 'spa');
  assert.equal(next[0].status, 'signed');
  assert.equal(next[1].status, 'ready'); // escrow armed
  assert.equal(closingProgress(next).done, 1);
  // A wire step lands in the `wired` terminal state.
  let s = next;
  s = executeStep(s, 'escrow');
  s = executeStep(s, 'cp');
  s = executeStep(s, 'wire');
  assert.equal(s.find((x) => x.id === 'wire')!.status, 'wired');
  assert.ok(isStepDone(s.find((x) => x.id === 'wire')!.status));
});

test('executing every step in order closes the deal', () => {
  let steps = closingStepsCopy(EX_CLOSINGS.helios);
  for (let guard = 0; guard < 20; guard++) {
    const idx = nextStepIndex(steps);
    if (idx < 0) break;
    steps = executeStep(steps, steps[idx].id);
  }
  const p = closingProgress(steps);
  assert.equal(p.closed, true);
  assert.equal(p.pct, 100);
  assert.equal(nextStepIndex(steps), -1);
});

test('executeStep is a no-op for an unknown id (returns a fresh copy)', () => {
  const steps = closingStepsCopy(EX_CLOSINGS.granite);
  const out = executeStep(steps, 'nope');
  assert.deepEqual(
    out.map((s) => s.status),
    steps.map((s) => s.status)
  );
  assert.notEqual(out, steps);
});

test('stepStatusMeta maps terminal, ready and waiting states', () => {
  assert.equal(stepStatusMeta('signed').label, 'Done');
  assert.equal(stepStatusMeta('wired').tone, 'success');
  assert.equal(stepStatusMeta('ready').tone, 'gold');
  assert.equal(stepStatusMeta('pending').label, 'Waiting');
});

test('stepRunSteps ends by logging to the Chain of Trust', () => {
  const steps = stepRunSteps(EX_CLOSINGS.helios.steps[0]);
  assert.ok(steps.length >= 2);
  assert.match(steps[steps.length - 1], /Chain of Trust/);
});
