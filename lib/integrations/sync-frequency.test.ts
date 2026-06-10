import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_FREQUENCIES,
  SYNC_FREQUENCY_OPTIONS,
  DEFAULT_SYNC_FREQUENCY,
  isSyncFrequency,
  toSyncFrequency
} from './sync-frequency';

/* ----------------------------------------------------------------------------
 * Sync-frequency source-of-truth regression suite.
 *
 * The route validation, the card selector, and the DB check constraint all key
 * off this one module — these tests lock the set, the guard, and the coercion
 * so the three never drift apart.
 * --------------------------------------------------------------------------*/

test('isSyncFrequency accepts every allowed cadence', () => {
  for (const f of SYNC_FREQUENCIES) assert.equal(isSyncFrequency(f), true);
});

test('isSyncFrequency rejects unknown / malformed input', () => {
  for (const bad of ['', 'weekly', 'REALTIME', ' hourly', 0, null, undefined, {}, ['daily']]) {
    assert.equal(isSyncFrequency(bad), false);
  }
});

test('the default cadence is itself a valid cadence', () => {
  assert.equal(isSyncFrequency(DEFAULT_SYNC_FREQUENCY), true);
});

test('toSyncFrequency passes valid values through and coerces the rest to default', () => {
  assert.equal(toSyncFrequency('daily'), 'daily');
  assert.equal(toSyncFrequency('manual'), 'manual');
  assert.equal(toSyncFrequency('nonsense'), DEFAULT_SYNC_FREQUENCY);
  assert.equal(toSyncFrequency(null), DEFAULT_SYNC_FREQUENCY);
});

test('selector options cover exactly the allowed cadences, in order', () => {
  assert.deepEqual(
    SYNC_FREQUENCY_OPTIONS.map((o) => o.value),
    [...SYNC_FREQUENCIES]
  );
  for (const o of SYNC_FREQUENCY_OPTIONS) assert.ok(o.label.length > 0);
});
