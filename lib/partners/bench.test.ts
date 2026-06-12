import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCH_NEXT,
  BENCH_STAGE_META,
  BENCH_STAGES,
  benchCategoryKey,
  benchMeta,
  benchNote,
  benchStage,
  compareBench,
  computeBenchFit,
  deriveBench,
  ESSENTIALS,
  essentialCoverage,
  relativeActivity
} from './bench';

test('benchStage maps directory status + intro request to the ladder', () => {
  // Active directory statuses read as engaged regardless of intro state.
  assert.equal(benchStage('active', null), 'engaged');
  assert.equal(benchStage('Engaged', 'requested'), 'engaged');
  assert.equal(benchStage('retained', null), 'engaged');
  // Intro lifecycle: requested/accepted → contacted, introduced → engaged.
  assert.equal(benchStage('prospect', 'requested'), 'contacted');
  assert.equal(benchStage('prospect', 'accepted'), 'contacted');
  assert.equal(benchStage('prospect', 'introduced'), 'engaged');
  // No request — or a declined one — stays suggested (re-requestable).
  assert.equal(benchStage('prospect', null), 'suggested');
  assert.equal(benchStage('prospect', 'declined'), 'suggested');
  assert.equal(benchStage(null, undefined), 'suggested');
});

test('stage vocabulary matches the prototype PROV_STAGES / PROV_NEXT', () => {
  assert.deepEqual([...BENCH_STAGES], ['suggested', 'contacted', 'engaged']);
  assert.equal(BENCH_STAGE_META.suggested.label, 'Suggested');
  assert.equal(BENCH_STAGE_META.contacted.tone, 'azure');
  assert.equal(BENCH_STAGE_META.engaged.tone, 'success');
  assert.equal(BENCH_NEXT.suggested, 'Request intro');
  assert.equal(BENCH_NEXT.contacted, 'Engage');
  assert.equal(BENCH_NEXT.engaged, undefined);
});

test('benchCategoryKey maps free-form categories to the prototype set', () => {
  assert.equal(benchCategoryKey('Legal Services'), 'counsel');
  assert.equal(benchCategoryKey('fund counsel'), 'counsel');
  assert.equal(benchCategoryKey('Fund Administration'), 'admin');
  assert.equal(benchCategoryKey('Audit & Tax'), 'audit');
  assert.equal(benchCategoryKey('accounting'), 'audit');
  // "Placement agent" must win over the broker/prime patterns.
  assert.equal(benchCategoryKey('Placement agent'), 'placement');
  assert.equal(benchCategoryKey('Prime brokerage'), 'prime');
  assert.equal(benchCategoryKey('Credit facility'), 'capital');
  assert.equal(benchCategoryKey('Technology'), 'other');
  assert.equal(benchCategoryKey(null), 'other');
});

test('essentialCoverage lights only on Engaged providers', () => {
  assert.equal(ESSENTIALS.length, 4);
  const cover = essentialCoverage([
    { category: 'Legal', stage: 'engaged' },
    { category: 'Fund administration', stage: 'contacted' },
    { category: 'Technology', stage: 'engaged' }
  ]);
  assert.deepEqual(
    cover.map((c) => [c.label, c.engaged]),
    [
      ['Fund counsel', true],
      ['Fund administration', false],
      ['Audit & tax', false],
      ['Placement agent', false]
    ]
  );
});

test('computeBenchFit rewards progress and vetting depth, capped at 98', () => {
  const bare = computeBenchFit({
    stage: 'suggested',
    essential: false,
    capabilityCount: 0,
    hasTerms: false,
    hasNote: false
  });
  assert.equal(bare, 58);
  const contacted = computeBenchFit({
    stage: 'contacted',
    essential: true,
    capabilityCount: 3,
    hasTerms: false,
    hasNote: true
  });
  const engaged = computeBenchFit({
    stage: 'engaged',
    essential: true,
    capabilityCount: 3,
    hasTerms: false,
    hasNote: true
  });
  assert.ok(bare < contacted && contacted < engaged);
  const maxed = computeBenchFit({
    stage: 'engaged',
    essential: true,
    capabilityCount: 50,
    hasTerms: true,
    hasNote: true
  });
  assert.equal(maxed, 98);
});

test('benchMeta reads tags and the _meta block, ignoring internals', () => {
  const meta = benchMeta({
    'LP portal': true,
    'NAV oversight': true,
    _meta: { description: 'Tech-forward admin', terms: 'Per-LP pricing', source: 'ai_discovery' }
  });
  assert.deepEqual(meta.tags, ['LP portal', 'NAV oversight']);
  assert.equal(meta.terms, 'Per-LP pricing');
  assert.equal(meta.note, 'Tech-forward admin');
  // fitRationale backs up a missing description; empty jsonb is all-null.
  assert.equal(benchMeta({ _meta: { fitRationale: 'Right-sized' } }).note, 'Right-sized');
  assert.deepEqual(benchMeta(null), { tags: [], terms: null, note: null });
});

test('benchNote prefers the vetting note, then tags, then honest state', () => {
  assert.equal(
    benchNote('suggested', { tags: ['a'], terms: null, note: 'Top practice' }),
    'Top practice'
  );
  assert.equal(
    benchNote('suggested', { tags: ['SPV', 'Funds', 'Tax', 'More'], terms: null, note: null }),
    'SPV · Funds · Tax'
  );
  assert.equal(
    benchNote('suggested', { tags: [], terms: null, note: null }),
    'Vetted for your bench'
  );
  assert.equal(benchNote('engaged', { tags: [], terms: null, note: null }), 'Active relationship');
});

test('deriveBench sorts Engaged first, then fit, then name', () => {
  const rows = deriveBench(
    [
      { id: 'a', name: 'Aldgate Audit', category: 'Audit', status: 'prospect', capabilities: {} },
      { id: 'b', name: 'Briar Counsel', category: 'Legal', status: 'active', capabilities: {} },
      { id: 'c', name: 'Cobalt Tech', category: 'Technology', status: 'prospect', capabilities: {} }
    ],
    { a: 'requested' }
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['b', 'a', 'c']
  );
  assert.equal(rows[0].stage, 'engaged');
  assert.equal(rows[1].stage, 'contacted');
  assert.ok(rows[1].fit > rows[2].fit);
  assert.equal(rows[2].category, 'Technology');
  // compareBench is the exported tie-breaker used by the grid.
  assert.ok(compareBench(rows[0], rows[2]) < 0);
});

test('relativeActivity renders honest recency or a dash', () => {
  const now = Date.parse('2026-06-12T12:00:00Z');
  assert.equal(relativeActivity(null, now), '—');
  assert.equal(relativeActivity('not-a-date', now), '—');
  assert.equal(relativeActivity('2026-06-12T08:00:00Z', now), 'Today');
  assert.equal(relativeActivity('2026-06-09T08:00:00Z', now), '3d ago');
  assert.equal(relativeActivity('2026-05-30T08:00:00Z', now), '1w ago');
  assert.equal(relativeActivity('2026-03-12T08:00:00Z', now), '3mo ago');
});
