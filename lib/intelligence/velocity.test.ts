import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVelocity, rankVelocity, type VelocityInput } from './velocity';

/* ----------------------------------------------------------------------------
 * Pipeline Velocity & Stuck-Deal Detector — pure-logic suite. Locks the
 * entered-stage resolution (latest stage move → created → updatedAt), the band
 * thresholds, closed-deal exclusion, and ranked ordering.
 * -------------------------------------------------------------------------- */

const NOW = Date.parse('2026-06-14T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function d(overrides: Partial<VelocityInput> = {}): VelocityInput {
  return {
    id: 'd1',
    name: 'Acme',
    stage: 'diligence',
    status: 'active',
    events: [
      { type: 'deal_stage', createdAt: daysAgo(50) },
      { type: 'deal_created', createdAt: daysAgo(120) }
    ],
    updatedAt: daysAgo(1),
    ...overrides
  };
}

test('time-in-stage uses the latest stage move, not the row update', () => {
  const r = computeVelocity(d(), NOW);
  assert.equal(r.daysInStage, 50);
  assert.equal(r.band, 'Stuck');
});

test('falls back to deal_created when there is no stage move', () => {
  const r = computeVelocity(d({ events: [{ type: 'deal_created', createdAt: daysAgo(30) }] }), NOW);
  assert.equal(r.daysInStage, 30);
  assert.equal(r.band, 'Slowing');
});

test('falls back to updatedAt when there are no events', () => {
  const r = computeVelocity(d({ events: [], updatedAt: daysAgo(5) }), NOW);
  assert.equal(r.daysInStage, 5);
  assert.equal(r.band, 'Moving');
});

test('bands: Moving < 21 <= Slowing < 45 <= Stuck', () => {
  assert.equal(
    computeVelocity(d({ events: [{ type: 'deal_stage', createdAt: daysAgo(10) }] }), NOW).band,
    'Moving'
  );
  assert.equal(
    computeVelocity(d({ events: [{ type: 'deal_stage', createdAt: daysAgo(21) }] }), NOW).band,
    'Slowing'
  );
  assert.equal(
    computeVelocity(d({ events: [{ type: 'deal_stage', createdAt: daysAgo(45) }] }), NOW).band,
    'Stuck'
  );
});

test('rankVelocity excludes closed deals and Moving deals, sorts by days desc', () => {
  const ranked = rankVelocity(
    [
      d({ id: 'moving', events: [{ type: 'deal_stage', createdAt: daysAgo(3) }] }),
      d({
        id: 'closed',
        status: 'closed',
        events: [{ type: 'deal_stage', createdAt: daysAgo(99) }]
      }),
      d({ id: 'slowing', events: [{ type: 'deal_stage', createdAt: daysAgo(25) }] }),
      d({ id: 'stuck', events: [{ type: 'deal_stage', createdAt: daysAgo(80) }] })
    ],
    NOW
  );
  assert.deepEqual(
    ranked.map((r) => r.dealId),
    ['stuck', 'slowing']
  );
});

test('never negative; same-day entry is 0 days', () => {
  const r = computeVelocity(d({ events: [{ type: 'deal_stage', createdAt: daysAgo(0) }] }), NOW);
  assert.equal(r.daysInStage, 0);
  assert.ok(Number.isFinite(r.daysInStage));
});
