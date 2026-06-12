import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSING_KINDS,
  STEP_SEQUENCE,
  closingProgress,
  isClosingKind,
  isSignatureStep,
  nextExecutableSeq,
  stepDisplayStatus,
  STEP_DISPLAY
} from './sequence';

test('every closing kind has an ordered, non-empty sequence ending in a record step', () => {
  for (const kind of CLOSING_KINDS) {
    assert.ok(isClosingKind(kind));
    const seq = STEP_SEQUENCE[kind];
    assert.ok(seq.length >= 3, `${kind} has steps`);
    for (const step of seq) {
      assert.ok(step.name.trim().length > 0);
      assert.ok(step.run.length >= 2);
    }
    assert.match(seq[seq.length - 1].name, /recorded/i);
  }
  assert.equal(isClosingKind('nope'), false);
});

test('nextExecutableSeq enforces strict in-order gating', () => {
  const steps = [
    { seq: 1, status: 'done' },
    { seq: 2, status: 'pending' },
    { seq: 3, status: 'pending' }
  ];
  assert.equal(nextExecutableSeq(steps), 2);
  // Out-of-order done rows don't unlock later steps early.
  assert.equal(
    nextExecutableSeq([
      { seq: 1, status: 'pending' },
      { seq: 2, status: 'done' },
      { seq: 3, status: 'pending' }
    ]),
    1
  );
  assert.equal(
    nextExecutableSeq([
      { seq: 1, status: 'done' },
      { seq: 2, status: 'done' }
    ]),
    null
  );
  assert.equal(nextExecutableSeq([]), null);
});

test('closingProgress derives pct and completion', () => {
  assert.deepEqual(closingProgress([]), { done: 0, total: 0, pct: 0, complete: false });
  assert.deepEqual(
    closingProgress([
      { seq: 1, status: 'done' },
      { seq: 2, status: 'pending' }
    ]),
    { done: 1, total: 2, pct: 50, complete: false }
  );
  assert.equal(
    closingProgress([
      { seq: 1, status: 'done' },
      { seq: 2, status: 'done' }
    ]).complete,
    true
  );
});

test('every step carries the prototype anatomy (who, party, drives, detail, action)', () => {
  for (const kind of CLOSING_KINDS) {
    for (const step of STEP_SEQUENCE[kind]) {
      assert.ok(step.who.trim().length > 0, `${kind}/${step.name} has who`);
      assert.ok(['GP', 'LP', 'Both'].includes(step.party));
      assert.ok(step.drives.trim().length > 0);
      assert.ok(step.detail.trim().length > 0);
      assert.ok(step.action.trim().length > 0);
    }
    // Each money-movement sequence marks exactly its wire steps.
    const wires = STEP_SEQUENCE[kind].filter((s) => s.wire);
    if (kind !== 'engagement') assert.equal(wires.length, 1, `${kind} has one wire step`);
  }
});

test('isSignatureStep marks signable, non-wire steps only', () => {
  // Every kind has at least one e-signable step, and no wire step is signable.
  for (const kind of CLOSING_KINDS) {
    const signable = STEP_SEQUENCE[kind].filter((s) => isSignatureStep(s));
    assert.ok(signable.length >= 1, `${kind} has a signature step`);
    for (const step of signable) assert.equal(step.wire, undefined);
  }
  assert.equal(isSignatureStep(undefined), false);
  assert.equal(isSignatureStep({ sign: true, wire: true } as never), false);
  assert.equal(isSignatureStep({ wire: false } as never), false);
});

test('stepDisplayStatus walks the prototype ladder', () => {
  assert.equal(stepDisplayStatus('done', false), 'signed');
  assert.equal(stepDisplayStatus('done', false, true), 'wired');
  assert.equal(stepDisplayStatus('pending', true), 'ready');
  assert.equal(stepDisplayStatus('pending', false), 'pending');
  assert.equal(STEP_DISPLAY.ready.tone, 'gold');
  assert.equal(STEP_DISPLAY.wired.label, 'Wired');
});
