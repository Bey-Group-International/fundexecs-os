import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMoves, deriveSignals, type DeskState } from './moves';

/* ----------------------------------------------------------------------------
 * Command Center moves regression suite.
 *
 * Locks the cockpit's plan derivation: an empty desk leads with the first
 * deal, the thinnest-layer fallback always exists, the queue is capped, and
 * signals reframe only REAL rows (empty desk → no signals).
 * --------------------------------------------------------------------------*/

function state(overrides: Partial<DeskState> = {}): DeskState {
  return {
    activeDealsCount: 0,
    capitalInMotion: 0,
    hotRelationshipsCount: 0,
    recentDeals: [],
    topWarmConnections: [],
    pct: { build: 40, source: 10, run: 0, execute: 0 },
    objective: null,
    ...overrides
  };
}

test('an empty desk leads with the first deal, then LP targets', () => {
  const moves = deriveMoves(state());
  assert.equal(moves[0].id, 'first-deal');
  assert.equal(moves[0].primary.href, '/source/pipeline');
  assert.equal(moves[1].id, 'lp-targets');
});

test('the thinnest layer is always covered — by a ranked move or the fallback', () => {
  // Here run (5%) is thinnest AND the diligence move already covers it, so
  // the fallback must NOT duplicate the hub.
  const busy = deriveMoves(
    state({
      activeDealsCount: 3,
      hotRelationshipsCount: 2,
      topWarmConnections: [{ id: 'c1', name: 'A', company: null, status: 'hot' }],
      pct: { build: 90, source: 80, run: 5, execute: 70 }
    })
  );
  assert.ok(busy.some((m) => m.hub === 'run'));
  assert.equal(busy.filter((m) => m.hub === 'run').length, 1);

  // With execute thinnest and nothing covering it, the fallback appears.
  const idle = deriveMoves(
    state({
      activeDealsCount: 3,
      hotRelationshipsCount: 2,
      topWarmConnections: [{ id: 'c1', name: 'A', company: null, status: 'hot' }],
      pct: { build: 90, source: 80, run: 70, execute: 5 }
    })
  );
  const fallback = idle.find((m) => m.id === 'advance-execute');
  assert.ok(fallback, 'thinnest-layer fallback missing');
  assert.equal(fallback?.primary.href, '/execute');
});

test('a raising desk with momentum gets the keep-it-moving move', () => {
  const moves = deriveMoves(
    state({
      activeDealsCount: 2,
      capitalInMotion: 12_000_000,
      hotRelationshipsCount: 3,
      topWarmConnections: [{ id: 'c1', name: 'A', company: null, status: 'hot' }],
      objective: 'raise'
    })
  );
  const raise = moves.find((m) => m.id === 'keep-raise-moving');
  assert.ok(raise);
  assert.match(raise!.title, /\$12\.0M|\$12M/);
  assert.equal(raise!.primary.href, '/execute/closings');
});

test('keep-raise-moving never fires without real capital in motion', () => {
  const moves = deriveMoves(
    state({
      activeDealsCount: 2,
      capitalInMotion: 0,
      hotRelationshipsCount: 3,
      topWarmConnections: [{ id: 'c1', name: 'A', company: null, status: 'hot' }],
      objective: 'raise'
    })
  );
  assert.equal(
    moves.find((m) => m.id === 'keep-raise-moving'),
    undefined
  );
});

test('the plan is capped at four moves', () => {
  const moves = deriveMoves(state({ objective: 'raise' }));
  assert.ok(moves.length <= 4);
});

test('raise-readiness fires when Build is thin, without displacing the hero', () => {
  // Empty desk, Build at 40% — readiness appears but never as the hero, and
  // the pinned opening (first-deal, then lp-targets) is preserved.
  const moves = deriveMoves(state({ pct: { build: 40, source: 10, run: 0, execute: 0 } }));
  assert.equal(moves[0].id, 'first-deal');
  assert.equal(moves[1].id, 'lp-targets');
  const readiness = moves.find((m) => m.id === 'raise-readiness');
  assert.ok(readiness, 'raise-readiness missing on a thin Build layer');
  assert.equal(readiness?.primary.href, '/build/formation');
  assert.equal(readiness?.hub, 'build');
});

test('raise-readiness respects the 70% boundary exactly', () => {
  // The gate is `< 70`, so at precisely 70% the move must not appear.
  const moves = deriveMoves(
    state({
      activeDealsCount: 3,
      hotRelationshipsCount: 2,
      topWarmConnections: [{ id: 'c1', name: 'A', company: null, status: 'hot' }],
      pct: { build: 70, source: 80, run: 75, execute: 65 }
    })
  );
  assert.equal(
    moves.find((m) => m.id === 'raise-readiness'),
    undefined,
    'raise-readiness should not appear at exactly 70%'
  );
});

test('raise-readiness stays quiet once Build is institutional', () => {
  const moves = deriveMoves(
    state({
      activeDealsCount: 3,
      hotRelationshipsCount: 2,
      topWarmConnections: [{ id: 'c1', name: 'A', company: null, status: 'hot' }],
      pct: { build: 90, source: 80, run: 70, execute: 5 }
    })
  );
  assert.equal(
    moves.find((m) => m.id === 'raise-readiness'),
    undefined
  );
});

test('signals reframe only real rows — an empty desk has none', () => {
  assert.deepEqual(deriveSignals(state()), []);
  const sigs = deriveSignals(
    state({
      recentDeals: [
        { id: 'd1', name: 'Helios', amount: 4_000_000 },
        { id: 'd2', name: 'Aster', amount: 0 },
        { id: 'd3', name: 'Cut', amount: 1 }
      ],
      topWarmConnections: [
        { id: 'c1', name: 'Meridian', company: 'Family office', status: 'hot' },
        { id: 'c2', name: 'Ridge', company: null, status: 'warm' }
      ]
    })
  );
  assert.equal(sigs.length, 4);
  assert.match(sigs[0].label, /Helios/);
  assert.match(sigs[0].label, /\$4\.0M|\$4M/);
  // An explicit zero amount still renders (only null hides the figure).
  assert.match(sigs[1].label, /Aster is on the desk · \$0/);
  assert.equal(sigs[2].tone, 'gold');
  assert.ok(sigs.every((s) => s.href.startsWith('/source/')));
});
