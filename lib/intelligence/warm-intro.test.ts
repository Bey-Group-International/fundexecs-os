import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  companyMatches,
  findIntroPaths,
  introWarmth,
  normalizeCompany,
  type PathfinderConnection,
  type PathfinderTarget
} from './warm-intro';

/* ----------------------------------------------------------------------------
 * Warm-Intro Pathfinder — pure-logic suite. Locks company matching, the warmth
 * blend, and per-target connector selection.
 * -------------------------------------------------------------------------- */

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-14T00:00:00Z');

function conn(over: Partial<PathfinderConnection> & { id: string }): PathfinderConnection {
  return {
    fullName: over.id,
    company: 'Acme Robotics',
    title: 'VP Eng',
    strength: 60,
    interactionCount: 10,
    lastInteractionAt: new Date(NOW - 10 * DAY).toISOString(),
    status: 'active',
    ...over
  };
}

test('normalizeCompany strips punctuation and legal/generic suffixes', () => {
  assert.equal(normalizeCompany('Acme Robotics, Inc.'), 'acme robotics');
  assert.equal(normalizeCompany('The Foo Co.'), 'foo');
});

test('companyMatches handles exact, containment, and token overlap', () => {
  assert.equal(companyMatches('Acme Robotics Series A', 'Acme Robotics'), true);
  assert.equal(companyMatches('Acme Robotics', 'Acme Robotics, Inc.'), true);
  assert.equal(companyMatches('Globex', 'Initech'), false);
  assert.equal(companyMatches('Anything', null), false);
});

test('introWarmth blends strength, depth, and recency', () => {
  // strength 60, depth 10/20=50, recency recent=100 → 0.5*60+0.2*50+0.3*100 = 70
  assert.equal(introWarmth(conn({ id: 'a' }), NOW), 70);
  // stale (>180d) drops recency to 15 → 0.5*60+0.2*50+0.3*15 = 44.5 → 45
  assert.equal(
    introWarmth(conn({ id: 'b', lastInteractionAt: new Date(NOW - 300 * DAY).toISOString() }), NOW),
    45
  );
});

test('warmth is safe with missing/NaN inputs', () => {
  const w = introWarmth(
    conn({ id: 'x', strength: Number.NaN, interactionCount: -5, lastInteractionAt: null }),
    NOW
  );
  assert.ok(Number.isFinite(w) && w >= 0 && w <= 100);
});

test('findIntroPaths picks the warmest connector per target and counts alternates', () => {
  const targets: PathfinderTarget[] = [
    { dealId: 'd1', dealName: 'Acme Robotics Series A', stage: 'meeting' }
  ];
  const connections = [
    conn({ id: 'warm', fullName: 'Warm Path', strength: 90 }),
    conn({ id: 'cool', fullName: 'Cool Path', strength: 30 }),
    conn({ id: 'other', company: 'Globex', strength: 99 })
  ];
  const paths = findIntroPaths(targets, connections, NOW);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].connectorId, 'warm');
  assert.equal(paths[0].altPaths, 1); // cool also matches Acme; Globex does not
});

test('targets with no matching connector yield no path', () => {
  const paths = findIntroPaths(
    [{ dealId: 'd', dealName: 'Initech', stage: 'prospect' }],
    [conn({ id: 'a', company: 'Acme Robotics' })],
    NOW
  );
  assert.deepEqual(paths, []);
});

test('paths are ranked warmest-first across targets', () => {
  const targets: PathfinderTarget[] = [
    { dealId: 'd1', dealName: 'Acme Robotics', stage: 'meeting' },
    { dealId: 'd2', dealName: 'Globex', stage: 'meeting' }
  ];
  const connections = [
    conn({ id: 'acme', company: 'Acme Robotics', strength: 40 }),
    conn({ id: 'globex', company: 'Globex', strength: 95 })
  ];
  const paths = findIntroPaths(targets, connections, NOW);
  assert.deepEqual(
    paths.map((p) => p.dealId),
    ['d2', 'd1']
  );
});
