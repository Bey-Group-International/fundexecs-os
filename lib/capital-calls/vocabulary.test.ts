import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callDistStatus,
  callPosture,
  callProgress,
  capitalSummary,
  CALL_RESOLVED_STATUS,
  isCallKind,
  isCallOverdue,
  isLpResolved,
  ledgerDistStatus,
  lpLineState,
  lpShare,
  proRataShares
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Capital calls vocabulary regression suite.
 *
 * Locks the derivations the server actions and the UI share: kind guard,
 * per-kind resolution status, settle-on-complete progress, per-LP shares
 * (pro-rata with the even-split fallback), derived overdue states, the
 * committed/called/dry-powder summary, and the merged distribution
 * status mapping.
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

test('proRataShares weights by commitment, zero for missing weights', () => {
  assert.deepEqual(
    proRataShares(1_000_000, [600_000, 300_000, 100_000]),
    [600_000, 300_000, 100_000]
  );
  // A missing weight reads as "no commitment amount on record" → 0.
  assert.deepEqual(proRataShares(900_000, [600_000, null, 300_000]), [600_000, 0, 300_000]);
});

test('proRataShares falls back to even split without positive weights', () => {
  assert.deepEqual(
    proRataShares(1_000_000, [null, null, null, null]),
    [250_000, 250_000, 250_000, 250_000]
  );
  assert.deepEqual(proRataShares(1_000_000, [0, 0]), [500_000, 500_000]);
});

test('proRataShares rejects junk totals', () => {
  assert.deepEqual(proRataShares(null, [100, 200]), [null, null]);
  assert.deepEqual(proRataShares(0, [100, 200]), [null, null]);
  assert.deepEqual(proRataShares(1_000_000, []), []);
});

test('proRataShares preserves the issued total under uneven ratios', () => {
  const sum = (shares: Array<number | null>) => shares.reduce((s: number, v) => s + (v ?? 0), 0);
  assert.equal(sum(proRataShares(100, [1, 1, 1])), 100);
  assert.deepEqual(proRataShares(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(sum(proRataShares(1_000_000, [null, null, null])), 1_000_000);
  assert.equal(sum(proRataShares(999_999, [7, 3, 11, 2])), 999_999);
  assert.equal(sum(proRataShares(2_500_000, [600_000, null, 300_000])), 2_500_000);
});

test('isCallOverdue flips only once the due day has fully passed', () => {
  const due = '2026-06-10';
  assert.equal(isCallOverdue(due, new Date('2026-06-10T23:00:00Z')), false);
  assert.equal(isCallOverdue(due, new Date('2026-06-11T00:00:01Z')), true);
  assert.equal(isCallOverdue(null, new Date('2026-06-11T00:00:01Z')), false);
  assert.equal(isCallOverdue('not-a-date', new Date('2026-06-11T00:00:01Z')), false);
});

test('lpLineState derives resolved / pending / overdue', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.equal(lpLineState('call', 'funded', 'issued', '2026-06-01', now), 'resolved');
  assert.equal(lpLineState('call', 'notified', 'issued', '2026-06-01', now), 'overdue');
  assert.equal(lpLineState('call', 'notified', 'issued', '2026-06-20', now), 'pending');
  assert.equal(lpLineState('call', 'notified', 'issued', null, now), 'pending');
  // A settled call has no overdue lines, whatever the due date says.
  assert.equal(lpLineState('call', 'notified', 'settled', '2026-06-01', now), 'pending');
});

test('callPosture orders settled > overdue > open', () => {
  assert.equal(callPosture('settled', 3), 'settled');
  assert.equal(callPosture('issued', 2), 'overdue');
  assert.equal(callPosture('issued', 0), 'open');
});

test('capitalSummary counts only calls and floors dry powder at zero', () => {
  const summary = capitalSummary(10_000_000, [
    { kind: 'call', total: 2_500_000 },
    { kind: 'call', total: null },
    { kind: 'distribution', total: 1_000_000 }
  ]);
  assert.deepEqual(summary, { committed: 10_000_000, called: 2_500_000, dryPowder: 7_500_000 });

  const overdrawn = capitalSummary(1_000_000, [{ kind: 'call', total: 2_000_000 }]);
  assert.equal(overdrawn.dryPowder, 0);
  assert.deepEqual(capitalSummary(Number.NaN, []), { committed: 0, called: 0, dryPowder: 0 });
});

test('ledgerDistStatus maps pending by date, paid/cancelled directly', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.equal(ledgerDistStatus('paid', '2026-06-01', now), 'paid');
  assert.equal(ledgerDistStatus('cancelled', '2026-06-01', now), 'cancelled');
  assert.equal(ledgerDistStatus('pending', '2026-09-01', now), 'planned');
  assert.equal(ledgerDistStatus('pending', '2026-06-01', now), 'staged');
  assert.equal(ledgerDistStatus('pending', null, now), 'staged');
});

test('callDistStatus: settled is paid, anything else is staged', () => {
  assert.equal(callDistStatus('settled'), 'paid');
  assert.equal(callDistStatus('issued'), 'staged');
});
