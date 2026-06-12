import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canResolveSignature,
  isWireDirection,
  isWireStatus,
  nextWireStatus,
  signatureSummary,
  WIRE_SEQUENCE,
  wireAction,
  wireBoard,
  wireTotals
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Signatures & wires vocabulary regression suite.
 *
 * Locks the gates the server actions enforce: a signature resolves exactly
 * once, wires advance strictly one stage at a time, and the ledger totals
 * count settled wires only — plus the board derivations the summary strip
 * and per-row actions read.
 * --------------------------------------------------------------------------*/

test('a signature resolves only from out_for_signature', () => {
  assert.equal(canResolveSignature('out_for_signature'), true);
  assert.equal(canResolveSignature('signed'), false);
  assert.equal(canResolveSignature('declined'), false);
  assert.equal(canResolveSignature('junk'), false);
});

test('wire stages advance strictly one at a time', () => {
  assert.equal(nextWireStatus('instructed'), 'sent');
  assert.equal(nextWireStatus('sent'), 'settled');
  assert.equal(nextWireStatus('settled'), null);
  assert.equal(nextWireStatus('junk'), null);
});

test('the wire sequence is the three known stages in order', () => {
  assert.deepEqual([...WIRE_SEQUENCE], ['instructed', 'sent', 'settled']);
  for (const s of WIRE_SEQUENCE) assert.equal(isWireStatus(s), true);
  assert.equal(isWireStatus('bounced'), false);
});

test('direction guard accepts only in/out', () => {
  assert.equal(isWireDirection('in'), true);
  assert.equal(isWireDirection('out'), true);
  assert.equal(isWireDirection('sideways'), false);
});

test('wireTotals counts settled wires only and nets directions', () => {
  const totals = wireTotals([
    { direction: 'in', amount: 1_000_000, status: 'settled' },
    { direction: 'in', amount: 250_000, status: 'sent' },
    { direction: 'out', amount: 400_000, status: 'settled' },
    { direction: 'out', amount: 50_000, status: 'instructed' },
    { direction: 'in', amount: -5, status: 'settled' },
    { direction: 'in', amount: 99, status: 'junk' }
  ]);
  assert.equal(totals.settledIn, 1_000_000);
  assert.equal(totals.settledOut, 400_000);
  assert.equal(totals.accounted, 600_000);
  assert.equal(totals.inFlight, 300_000);
});

test('wireTotals on an empty ledger is all zeros', () => {
  assert.deepEqual(wireTotals([]), { accounted: 0, settledIn: 0, settledOut: 0, inFlight: 0 });
});

test('signatureSummary counts signed over total with what is still out', () => {
  const summary = signatureSummary([
    { status: 'signed' },
    { status: 'out_for_signature' },
    { status: 'out_for_signature' },
    { status: 'declined' }
  ]);
  assert.deepEqual(summary, { signed: 1, total: 4, awaiting: 2 });
  assert.deepEqual(signatureSummary([]), { signed: 0, total: 0, awaiting: 0 });
});

test('wireAction: gold Release on staged outbound, Confirm otherwise, null terminal', () => {
  assert.deepEqual(wireAction('out', 'instructed'), { label: 'Release', gold: true });
  assert.deepEqual(wireAction('out', 'sent'), { label: 'Confirm', gold: false });
  assert.deepEqual(wireAction('in', 'instructed'), { label: 'Confirm', gold: false });
  assert.deepEqual(wireAction('in', 'sent'), { label: 'Confirm', gold: false });
  assert.equal(wireAction('out', 'settled'), null);
  assert.equal(wireAction('in', 'junk'), null);
});

test('wireBoard derives the outbound/inbound summary tiles', () => {
  const board = wireBoard([
    { direction: 'out', amount: 500_000, status: 'instructed' },
    { direction: 'out', amount: 200_000, status: 'sent' },
    { direction: 'out', amount: 100_000, status: 'settled' },
    { direction: 'in', amount: 1_000_000, status: 'instructed' },
    { direction: 'in', amount: 300_000, status: 'settled' },
    { direction: 'in', amount: -1, status: 'sent' },
    { direction: 'out', amount: 99, status: 'junk' }
  ]);
  assert.deepEqual(board, { outStaged: 1, outTotal: 800_000, inExpected: 1_000_000 });
  assert.deepEqual(wireBoard([]), { outStaged: 0, outTotal: 0, inExpected: 0 });
});
