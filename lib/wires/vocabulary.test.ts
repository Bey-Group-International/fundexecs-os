import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canChaseSignature,
  canClearWire,
  canResolveSignature,
  canSignatureTransition,
  initialWireStatus,
  isSignatureStatus,
  isValidWirePair,
  isWireDirection,
  isWireStatus,
  signatureSummary,
  wireClearVerb,
  wireSummary
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Signatures & wires vocabulary regression suite.
 *
 * Locks the gates the server actions enforce: a signature only moves
 * forward (awaiting → partial → signed | declined), a wire clears exactly
 * once by direction (staged → cleared, expected → cleared), and the board
 * summaries count only well-formed rows.
 * --------------------------------------------------------------------------*/

test('signature transitions only move forward', () => {
  assert.equal(canSignatureTransition('out_for_signature', 'partial'), true);
  assert.equal(canSignatureTransition('out_for_signature', 'signed'), true);
  assert.equal(canSignatureTransition('out_for_signature', 'declined'), true);
  assert.equal(canSignatureTransition('partial', 'signed'), true);
  assert.equal(canSignatureTransition('partial', 'declined'), true);
  assert.equal(canSignatureTransition('partial', 'partial'), false);
  assert.equal(canSignatureTransition('partial', 'out_for_signature'), false);
  assert.equal(canSignatureTransition('signed', 'declined'), false);
  assert.equal(canSignatureTransition('declined', 'signed'), false);
  assert.equal(canSignatureTransition('junk', 'signed'), false);
});

test('a signature resolves only while in motion', () => {
  assert.equal(canResolveSignature('out_for_signature'), true);
  assert.equal(canResolveSignature('partial'), true);
  assert.equal(canResolveSignature('signed'), false);
  assert.equal(canResolveSignature('declined'), false);
  assert.equal(canResolveSignature('junk'), false);
});

test('only partial signatures get chased', () => {
  assert.equal(canChaseSignature('partial'), true);
  assert.equal(canChaseSignature('out_for_signature'), false);
  assert.equal(canChaseSignature('signed'), false);
});

test('signature status guard knows the four stages', () => {
  for (const s of ['out_for_signature', 'partial', 'signed', 'declined']) {
    assert.equal(isSignatureStatus(s), true);
  }
  assert.equal(isSignatureStatus('countersigned'), false);
});

test('signatureSummary counts signed and in-motion rows', () => {
  const summary = signatureSummary([
    { status: 'signed' },
    { status: 'signed' },
    { status: 'partial' },
    { status: 'out_for_signature' },
    { status: 'declined' }
  ]);
  assert.deepEqual(summary, { total: 5, signed: 2, awaiting: 2 });
  assert.deepEqual(signatureSummary([]), { total: 0, signed: 0, awaiting: 0 });
});

test('a wire opens by direction — staged out, expected in', () => {
  assert.equal(initialWireStatus('out'), 'staged');
  assert.equal(initialWireStatus('in'), 'expected');
});

test('a wire clears exactly once', () => {
  assert.equal(canClearWire('staged'), true);
  assert.equal(canClearWire('expected'), true);
  assert.equal(canClearWire('cleared'), false);
  assert.equal(canClearWire('junk'), false);
});

test('the clear verb follows the money', () => {
  assert.equal(wireClearVerb('out'), 'Release');
  assert.equal(wireClearVerb('in'), 'Confirm');
});

test('status and direction guards reject strays', () => {
  for (const s of ['staged', 'expected', 'cleared']) assert.equal(isWireStatus(s), true);
  assert.equal(isWireStatus('settled'), false);
  assert.equal(isWireDirection('in'), true);
  assert.equal(isWireDirection('out'), true);
  assert.equal(isWireDirection('sideways'), false);
});

test('isValidWirePair allows only direction-appropriate stages', () => {
  assert.equal(isValidWirePair('out', 'staged'), true);
  assert.equal(isValidWirePair('out', 'cleared'), true);
  assert.equal(isValidWirePair('out', 'expected'), false);
  assert.equal(isValidWirePair('in', 'expected'), true);
  assert.equal(isValidWirePair('in', 'cleared'), true);
  assert.equal(isValidWirePair('in', 'staged'), false);
  assert.equal(isValidWirePair('sideways', 'cleared'), false);
  assert.equal(isValidWirePair('out', 'settled'), false);
});

test('wireSummary counts only well-formed rows', () => {
  const summary = wireSummary([
    { direction: 'out', amount: 18_000_000, status: 'staged' },
    { direction: 'out', amount: 750_000, status: 'cleared' },
    { direction: 'in', amount: 10_000_000, status: 'expected' },
    { direction: 'in', amount: 6_000_000, status: 'cleared' },
    { direction: 'in', amount: -5, status: 'expected' },
    { direction: 'out', amount: 99, status: 'settled' },
    { direction: 'sideways', amount: 99, status: 'staged' },
    // impossible direction/status pair — must be ignored
    { direction: 'out', amount: 5_000_000, status: 'expected' },
    { direction: 'in', amount: 5_000_000, status: 'staged' }
  ]);
  assert.equal(summary.outStagedCount, 1);
  assert.equal(summary.outTotal, 18_750_000);
  assert.equal(summary.inExpected, 10_000_000);
  assert.equal(summary.clearedIn, 6_000_000);
  assert.equal(summary.clearedOut, 750_000);
});

test('wireSummary on an empty ledger is all zeros', () => {
  assert.deepEqual(wireSummary([]), {
    outStagedCount: 0,
    outTotal: 0,
    inExpected: 0,
    clearedIn: 0,
    clearedOut: 0
  });
});
