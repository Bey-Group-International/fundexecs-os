import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveInstrument, matchesInstrument } from './instrument';

test('deriveInstrument defaults unsignalled text to equity', () => {
  assert.equal(deriveInstrument(null, undefined, ''), 'equity');
  assert.equal(deriveInstrument('Family office', 'committed'), 'equity');
  assert.equal(deriveInstrument('LP into Fund II'), 'equity');
});

test('deriveInstrument detects debt structures', () => {
  assert.equal(deriveInstrument('Term loan facility'), 'debt');
  assert.equal(deriveInstrument(null, 'promissory note for bridge'), 'debt');
  assert.equal(deriveInstrument('Mezzanine credit line'), 'debt');
});

test('deriveInstrument treats blended structures as hybrid, outranking debt', () => {
  // "convertible note" carries the debt hint "note" but must resolve to hybrid.
  assert.equal(deriveInstrument('Convertible note'), 'hybrid');
  assert.equal(deriveInstrument('SAFE'), 'hybrid');
  assert.equal(deriveInstrument('Venture debt with warrants'), 'hybrid');
  assert.equal(deriveInstrument('Preferred equity'), 'hybrid');
});

test('matchesInstrument honors the "all" sentinel and exact matches', () => {
  assert.equal(matchesInstrument('debt', 'all'), true);
  assert.equal(matchesInstrument('debt', 'debt'), true);
  assert.equal(matchesInstrument('debt', 'equity'), false);
});
