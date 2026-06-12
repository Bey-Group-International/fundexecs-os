import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canChaseSignature,
  canMarkSignaturePartial,
  canResolveSignature,
  clearWireVerb,
  isValidWirePair,
  isWireDirection,
  isWireStatus,
  nextWireStatus,
  stagedWireStatus,
  WIRE_STATUSES,
  wireTotals
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Signatures & wires vocabulary regression suite.
 *
 * Locks the gates the server actions enforce: a signature resolves exactly
 * once (awaiting/partial → signed/declined), wires clear in exactly one
 * transition (staged → cleared on release, expected → cleared on confirm),
 * and the ledger totals account cleared wires only.
 * --------------------------------------------------------------------------*/

test('a signature resolves only from awaiting or partial', () => {
  assert.equal(canResolveSignature('out_for_signature'), true);
  assert.equal(canResolveSignature('partial'), true);
  assert.equal(canResolveSignature('signed'), false);
  assert.equal(canResolveSignature('declined'), false);
  assert.equal(canResolveSignature('junk'), false);
});

test('partial is reachable only from awaiting', () => {
  assert.equal(canMarkSignaturePartial('out_for_signature'), true);
  assert.equal(canMarkSignaturePartial('partial'), false);
  assert.equal(canMarkSignaturePartial('signed'), false);
});

test('chase targets partial documents only', () => {
  assert.equal(canChaseSignature('partial'), true);
  assert.equal(canChaseSignature('out_for_signature'), false);
  assert.equal(canChaseSignature('signed'), false);
});

test('a wire stages by direction — out staged, in expected', () => {
  assert.equal(stagedWireStatus('out'), 'staged');
  assert.equal(stagedWireStatus('in'), 'expected');
});

test('a wire clears in exactly one transition', () => {
  assert.equal(nextWireStatus('staged'), 'cleared');
  assert.equal(nextWireStatus('expected'), 'cleared');
  assert.equal(nextWireStatus('cleared'), null);
  assert.equal(nextWireStatus('junk'), null);
});

test('the clearing verb matches the prototype — release out, confirm in', () => {
  assert.equal(clearWireVerb('staged'), 'release');
  assert.equal(clearWireVerb('expected'), 'confirm');
  assert.equal(clearWireVerb('cleared'), null);
  assert.equal(clearWireVerb('junk'), null);
});

test('the wire statuses are the three known states', () => {
  assert.deepEqual([...WIRE_STATUSES], ['staged', 'expected', 'cleared']);
  for (const s of WIRE_STATUSES) assert.equal(isWireStatus(s), true);
  assert.equal(isWireStatus('settled'), false);
  assert.equal(isWireStatus('instructed'), false);
});

test('direction guard accepts only in/out', () => {
  assert.equal(isWireDirection('in'), true);
  assert.equal(isWireDirection('out'), true);
  assert.equal(isWireDirection('sideways'), false);
});

test('isValidWirePair allows only direction-appropriate states', () => {
  assert.equal(isValidWirePair('out', 'staged'), true);
  assert.equal(isValidWirePair('out', 'cleared'), true);
  assert.equal(isValidWirePair('out', 'expected'), false);
  assert.equal(isValidWirePair('in', 'expected'), true);
  assert.equal(isValidWirePair('in', 'cleared'), true);
  assert.equal(isValidWirePair('in', 'staged'), false);
  assert.equal(isValidWirePair('sideways', 'cleared'), false);
  assert.equal(isValidWirePair('out', 'junk'), false);
});

test('wireTotals accounts cleared wires only and nets directions', () => {
  const totals = wireTotals([
    { direction: 'in', amount: 1_000_000, status: 'cleared' },
    { direction: 'in', amount: 250_000, status: 'expected' },
    { direction: 'out', amount: 400_000, status: 'cleared' },
    { direction: 'out', amount: 50_000, status: 'staged' },
    { direction: 'in', amount: -5, status: 'cleared' },
    { direction: 'in', amount: 99, status: 'junk' },
    // impossible direction/status pairs — must be ignored
    { direction: 'out', amount: 5_000_000, status: 'expected' },
    { direction: 'in', amount: 5_000_000, status: 'staged' }
  ]);
  assert.equal(totals.clearedIn, 1_000_000);
  assert.equal(totals.clearedOut, 400_000);
  assert.equal(totals.accounted, 600_000);
  assert.equal(totals.inFlight, 300_000);
  assert.equal(totals.outboundStaged, 1);
  assert.equal(totals.outboundTotal, 450_000);
  assert.equal(totals.inboundExpected, 250_000);
});

test('wireTotals on an empty ledger is all zeros', () => {
  assert.deepEqual(wireTotals([]), {
    accounted: 0,
    clearedIn: 0,
    clearedOut: 0,
    inFlight: 0,
    outboundStaged: 0,
    outboundTotal: 0,
    inboundExpected: 0
  });
});
