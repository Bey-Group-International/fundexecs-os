import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelForInteraction, scoreInboxItem, shouldSurface } from './ingest';

/* ----------------------------------------------------------------------------
 * Relationship Inbox ingest core (pure mapping + scoring).
 *
 * Locks the contract the Gmail/Slack/call ingestion depends on: which
 * interactions become inbox channels, which ones surface in the worklist, and
 * that the score is a deterministic, explainable 0-100 with rationale in the
 * same shape as matches.rationale.
 * --------------------------------------------------------------------------*/

test('channelForInteraction maps providers + types to channels', () => {
  assert.equal(channelForInteraction('gmail', 'email_received'), 'email');
  assert.equal(channelForInteraction('gmail', 'email_sent'), 'email');
  assert.equal(channelForInteraction('slack', 'message'), 'slack');
  assert.equal(channelForInteraction('zoom', 'meeting'), 'call');
  assert.equal(channelForInteraction('google_meet', 'meeting'), 'call');
  assert.equal(channelForInteraction('calendly', 'meeting'), 'call');
});

test('channelForInteraction returns null for non-conversation signals', () => {
  // Calendar events + notes are not conversations to triage.
  assert.equal(channelForInteraction('google_calendar', 'meeting'), null);
  assert.equal(channelForInteraction('gmail', 'calendar_event'), null);
  assert.equal(channelForInteraction('gmail', 'note'), null);
});

test('shouldSurface keeps inbound email/slack but all calls', () => {
  assert.equal(shouldSurface('email', 'inbound'), true);
  assert.equal(shouldSurface('email', 'outbound'), false);
  assert.equal(shouldSurface('slack', 'outbound'), false);
  assert.equal(shouldSurface('call', 'outbound'), true);
  assert.equal(shouldSurface('call', 'inbound'), true);
});

test('scoreInboxItem is a bounded, explainable 0-100 score', () => {
  const now = Date.parse('2026-06-13T00:00:00Z');
  const fresh = scoreInboxItem({
    channel: 'email',
    direction: 'inbound',
    occurredAt: '2026-06-12T18:00:00Z', // ~6h ago
    hasContact: true,
    now
  });

  // recency(30) + channel(25) + relationship(15) + responsiveness(10) = 80.
  assert.equal(fresh.score, 80);
  assert.ok(fresh.score >= 0 && fresh.score <= 100);

  // Rationale mirrors matches.rationale: every factor carries a numeric weight.
  const factors = fresh.rationale.map((r) => r.factor).sort();
  assert.deepEqual(factors, ['channel', 'recency', 'relationship', 'responsiveness']);
  for (const r of fresh.rationale) assert.equal(typeof r.weight, 'number');
});

test('scoreInboxItem decays with age and rewards known contacts', () => {
  const now = Date.parse('2026-06-13T00:00:00Z');
  const old = scoreInboxItem({
    channel: 'email',
    direction: 'inbound',
    occurredAt: '2026-01-01T00:00:00Z', // months ago
    hasContact: false,
    now
  });
  // recency(5) + channel(25) + relationship(5) + responsiveness(10) = 45.
  assert.equal(old.score, 45);
});

test('scoreInboxItem never exceeds 100', () => {
  const now = Date.parse('2026-06-13T00:00:00Z');
  const max = scoreInboxItem({
    channel: 'email',
    direction: 'inbound',
    occurredAt: '2026-06-13T00:00:00Z',
    hasContact: true,
    now
  });
  assert.ok(max.score <= 100);
});
