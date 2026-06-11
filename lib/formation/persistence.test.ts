import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATION_D0 } from './config';
import { sanitizeFormationData } from './persistence';

test('sanitize of empty/garbage input round-trips the defaults', () => {
  assert.deepEqual(sanitizeFormationData(undefined), FORMATION_D0);
  assert.deepEqual(sanitizeFormationData(null), FORMATION_D0);
  assert.deepEqual(sanitizeFormationData('not an object'), FORMATION_D0);
  assert.deepEqual(sanitizeFormationData(42), FORMATION_D0);
});

test('sanitize keeps well-typed values and drops mistyped ones', () => {
  const out = sanitizeFormationData({
    storyHook: 'A focused fund.',
    fee: 1.5,
    termsUndecided: true,
    storyEdges: ['Operator experience', 7, 'Strong network'],
    entity: 999, // wrong type → default
    unknownKey: 'ignored'
  });
  assert.equal(out.storyHook, 'A focused fund.');
  assert.equal(out.fee, 1.5);
  assert.equal(out.termsUndecided, true);
  assert.deepEqual(out.storyEdges, ['Operator experience', 'Strong network']);
  assert.equal(out.entity, FORMATION_D0.entity);
  assert.ok(!('unknownKey' in out));
});

test('sanitize caps oversized strings and arrays', () => {
  const out = sanitizeFormationData({
    storyOrigin: 'x'.repeat(5000),
    storyEdges: Array.from({ length: 50 }, (_, i) => `edge-${i}`)
  });
  assert.equal(out.storyOrigin.length, 2000);
  assert.equal(out.storyEdges.length, 12);
});

test('sanitize never returns NaN numbers', () => {
  const out = sanitizeFormationData({ carry: Number.NaN, hurdle: Infinity });
  assert.equal(out.carry, FORMATION_D0.carry);
  assert.equal(out.hurdle, FORMATION_D0.hurdle);
});
