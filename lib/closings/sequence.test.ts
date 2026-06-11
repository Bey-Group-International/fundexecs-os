import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSING_KINDS,
  STEP_SEQUENCE,
  closingProgress,
  isClosingKind,
  nextExecutableSeq
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
