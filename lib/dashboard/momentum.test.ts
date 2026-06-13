import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentumDelta } from './momentum';

test('no prior snapshot yields a null delta (never fabricated)', () => {
  assert.deepEqual(momentumDelta(72, null), { value: 72, delta: null, direction: 'flat' });
  assert.deepEqual(momentumDelta(72, undefined), { value: 72, delta: null, direction: 'flat' });
});

test('a rise reports a positive delta and up direction', () => {
  assert.deepEqual(momentumDelta(72, 67), { value: 72, delta: 5, direction: 'up' });
});

test('a fall reports a negative delta and down direction', () => {
  assert.deepEqual(momentumDelta(60, 70), { value: 60, delta: -10, direction: 'down' });
});

test('an unchanged value is flat with a zero delta', () => {
  assert.deepEqual(momentumDelta(55, 55), { value: 55, delta: 0, direction: 'flat' });
});

test('both ends are rounded so fractional scores never leak a misleading delta', () => {
  assert.deepEqual(momentumDelta(72.4, 70.6), { value: 72, delta: 1, direction: 'up' });
});

test('a non-finite prior degrades to no-Δ rather than NaN', () => {
  assert.deepEqual(momentumDelta(50, Number.NaN), { value: 50, delta: null, direction: 'flat' });
});

test('a non-finite current floors to a safe zero value', () => {
  assert.deepEqual(momentumDelta(Number.NaN, 40), { value: 0, delta: -40, direction: 'down' });
});
