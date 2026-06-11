import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canResolveSignature,
  isWireDirection,
  isWireStatus,
  nextWireStatus,
  WIRE_SEQUENCE,
  wireTotals
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Signatures & wires vocabulary regression suite.
 *
 * Locks the gates the server actions enforce: a signature resolves exactly
 * once, wires advance strictly one stage at a time, and the ledger totals
 * count settled wires only.
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
