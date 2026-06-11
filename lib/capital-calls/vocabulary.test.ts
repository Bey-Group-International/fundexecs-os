import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callProgress,
  CALL_RESOLVED_STATUS,
  isCallKind,
  isLpResolved,
  lpShare
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Capital calls vocabulary regression suite.
 *
 * Locks the derivations the server actions and the UI share: kind guard,
 * per-kind resolution status, settle-on-complete progress, and the even
 * per-LP share split.
 * --------------------------------------------------------------------------*/

test('kind guard accepts only call/distribution', () => {
  assert.equal(isCallKind('call'), true);
  assert.equal(isCallKind('distribution'), true);
  assert.equal(isCallKind('drawdown'), false);
});

test('resolution status differs by kind', () => {
  assert.equal(CALL_RESOLVED_STATUS.call, 'funded');
  assert.equal(CALL_RESOLVED_STATUS.distribution, 'paid');
  assert.equal(isLpResolved('call', 'funded'), true);
  assert.equal(isLpResolved('call', 'paid'), false);
  assert.equal(isLpResolved('distribution', 'paid'), true);
  assert.equal(isLpResolved('distribution', 'notified'), false);
});

test('callProgress completes only when every line resolves', () => {
  const partial = callProgress('call', [
    { status: 'funded' },
    { status: 'notified' },
    { status: 'funded' }
  ]);
  assert.deepEqual(partial, { resolved: 2, total: 3, pct: 67, complete: false });

  const done = callProgress('call', [{ status: 'funded' }, { status: 'funded' }]);
  assert.equal(done.complete, true);
  assert.equal(done.pct, 100);

  const empty = callProgress('call', []);
  assert.equal(empty.complete, false);
  assert.equal(empty.pct, 0);
});

test('lpShare splits evenly and rejects junk', () => {
  assert.equal(lpShare(1_000_000, 4), 250_000);
  assert.equal(lpShare(1_000_000, 3), 333_333);
  assert.equal(lpShare(null, 4), null);
  assert.equal(lpShare(0, 4), null);
  assert.equal(lpShare(1_000_000, 0), null);
});
