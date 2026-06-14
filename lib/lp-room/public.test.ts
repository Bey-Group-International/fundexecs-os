import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lpRoomKind, lpRoomTierFromKind, tierAllowedAccessLevels, type LpRoomTier } from './public';

/**
 * Security-critical: the tier helpers decide which documents leave the org on
 * an unauthenticated surface. These tests pin the fail-closed behaviour —
 * admin-only is never reachable, unknown input degrades to the most
 * restrictive tier, and the kind round-trips.
 */

test('lpRoomKind round-trips through lpRoomTierFromKind', () => {
  for (const tier of ['prospect', 'committed'] as LpRoomTier[]) {
    assert.equal(lpRoomTierFromKind(lpRoomKind(tier)), tier);
  }
});

test('lpRoomTierFromKind rejects non-LP-room kinds (fail closed)', () => {
  assert.equal(lpRoomTierFromKind(null), null);
  assert.equal(lpRoomTierFromKind(''), null);
  assert.equal(lpRoomTierFromKind('deck'), null);
  assert.equal(lpRoomTierFromKind('investor_deck'), null);
  // A material_kind that merely contains the word must not match.
  assert.equal(lpRoomTierFromKind('not_lp_room:committed'), null);
});

test('lpRoomTierFromKind degrades unknown tiers to the most restrictive', () => {
  assert.equal(lpRoomTierFromKind('lp_room:admin'), 'prospect');
  assert.equal(lpRoomTierFromKind('lp_room:'), 'prospect');
  assert.equal(lpRoomTierFromKind('lp_room:committed'), 'committed');
});

test('tierAllowedAccessLevels never includes admin-only', () => {
  for (const tier of ['prospect', 'committed'] as LpRoomTier[]) {
    const allowed = tierAllowedAccessLevels(tier);
    assert.ok(!allowed.includes('admin-only'), `${tier} must not see admin-only`);
  }
});

test('prospect sees prospect only; committed sees prospect + committed', () => {
  assert.deepEqual(tierAllowedAccessLevels('prospect'), ['prospect']);
  assert.deepEqual(tierAllowedAccessLevels('committed').sort(), ['committed', 'prospect']);
});
