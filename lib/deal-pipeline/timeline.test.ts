import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTimeline, timeAgo } from './timeline';

const T0 = '2026-06-01T10:00:00Z';
const T1 = '2026-06-02T10:00:00Z';
const T2 = '2026-06-03T10:00:00Z';

test('mergeTimeline: interleaves notes and events newest-first', () => {
  const items = mergeTimeline(
    [{ id: 'n1', body: 'Spoke to the founder', createdAt: T1 }],
    [
      { id: 'e1', type: 'deal_created', stage: 'prospect', createdAt: T0 },
      { id: 'e2', type: 'deal_stage', stage: 'qualified', createdAt: T2 }
    ]
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ['e2', 'n1', 'e1']
  );
  assert.deepEqual(
    items.map((i) => i.kind),
    ['stage', 'note', 'created']
  );
  assert.equal(items[0].stage, 'qualified');
  assert.equal(items[1].body, 'Spoke to the founder');
});

test('mergeTimeline: drops unknown event types', () => {
  const items = mergeTimeline(
    [],
    [
      { id: 'e1', type: 'meeting_analyzed', stage: null, createdAt: T0 },
      { id: 'e2', type: 'deal_stage', stage: 'meeting', createdAt: T1 }
    ]
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ['e2']
  );
});

test('mergeTimeline: ties on timestamp resolve deterministically by id', () => {
  const items = mergeTimeline(
    [{ id: 'b', body: 'x', createdAt: T0 }],
    [{ id: 'a', type: 'deal_created', stage: null, createdAt: T0 }]
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ['a', 'b']
  );
});

test('timeAgo: compact buckets from minutes to months', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString();
  assert.equal(timeAgo(ago(0), now), 'just now');
  assert.equal(timeAgo(ago(5), now), '5m ago');
  assert.equal(timeAgo(ago(3 * 60), now), '3h ago');
  assert.equal(timeAgo(ago(30 * 60), now), 'yesterday');
  assert.equal(timeAgo(ago(5 * 24 * 60), now), '5d ago');
  assert.equal(timeAgo(ago(21 * 24 * 60), now), '3w ago');
  assert.equal(timeAgo(ago(95 * 24 * 60), now), '3mo ago');
  assert.equal(timeAgo('not-a-date', now), '');
});
