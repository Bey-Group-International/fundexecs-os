import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReconnect, rankReconnects, type ReconnectInput } from './reconnect';

/* ----------------------------------------------------------------------------
 * Relationship Reconnect Engine — pure-logic suite. Locks the core idea: depth
 * × staleness (not decayed strength), the staleness window, null-date handling,
 * banding, and ranked filtering.
 * -------------------------------------------------------------------------- */

const NOW = Date.parse('2026-06-14T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function c(overrides: Partial<ReconnectInput> = {}): ReconnectInput {
  return {
    id: 'c1',
    fullName: 'Jane Doe',
    company: 'Acme',
    strength: 40,
    status: 'warm',
    interactionCount: 12,
    lastInteractionAt: daysAgo(90),
    ...overrides
  };
}

test('a deep relationship gone cold is Overdue', () => {
  const r = computeReconnect(c({ interactionCount: 20, lastInteractionAt: daysAgo(120) }), NOW);
  assert.equal(r.band, 'Overdue');
  assert.ok(r.priority >= 60);
});

test('a freshly-touched relationship is Healthy (no urgency)', () => {
  const r = computeReconnect(c({ interactionCount: 20, lastInteractionAt: daysAgo(3) }), NOW);
  assert.equal(r.band, 'Healthy');
  assert.equal(r.priority, 0);
});

test('a shallow relationship never ranks high even when stale', () => {
  const r = computeReconnect(c({ interactionCount: 1, lastInteractionAt: daysAgo(300) }), NOW);
  assert.ok(r.priority < 30);
});

test('staleness increases priority for the same depth', () => {
  const mild = computeReconnect(c({ interactionCount: 20, lastInteractionAt: daysAgo(30) }), NOW);
  const severe = computeReconnect(
    c({ interactionCount: 20, lastInteractionAt: daysAgo(110) }),
    NOW
  );
  assert.ok(severe.priority > mild.priority);
});

test('null last-interaction with history is treated as fully stale', () => {
  const r = computeReconnect(c({ interactionCount: 20, lastInteractionAt: null }), NOW);
  assert.equal(r.daysSince, null);
  assert.ok(r.priority >= 60);
  assert.match(r.reason, /no recent contact/i);
});

test('never NaN; zero-history contact is Healthy', () => {
  const r = computeReconnect(c({ interactionCount: 0, lastInteractionAt: null }), NOW);
  assert.ok(Number.isFinite(r.priority));
  assert.equal(r.priority, 0);
  assert.equal(r.band, 'Healthy');
});

test('rankReconnects drops Healthy and sorts by priority desc', () => {
  const ranked = rankReconnects(
    [
      c({ id: 'fresh', interactionCount: 20, lastInteractionAt: daysAgo(2) }), // Healthy → dropped
      c({ id: 'mild', interactionCount: 20, lastInteractionAt: daysAgo(60) }), // Due soon
      c({ id: 'severe', interactionCount: 20, lastInteractionAt: daysAgo(115) }) // Overdue
    ],
    NOW
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['severe', 'mild']
  );
});
