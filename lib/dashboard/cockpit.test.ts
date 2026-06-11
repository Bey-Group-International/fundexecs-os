import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COCKPIT_HUBS, deriveCockpit, type HubKey } from './cockpit';
import type { LifecycleStage, ReadinessDimensionScore } from '@/lib/lifecycle';

/** Build a readiness breakdown from a partial dimension→score map. */
function bd(scores: Partial<Record<string, number>>): ReadinessDimensionScore[] {
  const dims = ['profile', 'proof', 'materials', 'pipeline', 'capital'];
  return dims.map((dimension) => ({
    dimension: dimension as ReadinessDimensionScore['dimension'],
    score: scores[dimension] ?? 0,
    weight: 20,
    contribution: ((scores[dimension] ?? 0) * 20) / 100
  }));
}

test('deriveCockpit returns the four loop verbs in rail order', () => {
  const hubs = deriveCockpit({ readinessBreakdown: bd({}), stage: 'establish_truth' });
  assert.deepEqual(
    hubs.map((h) => h.key),
    ['build', 'source', 'run', 'drive']
  );
  for (const h of hubs) {
    const meta = COCKPIT_HUBS.find((m) => m.key === h.key);
    assert.equal(h.href, meta?.href);
    assert.ok(h.href.startsWith('/'));
  }
});

test('deriveCockpit maps readiness dimensions onto the verbs', () => {
  const hubs = deriveCockpit({
    readinessBreakdown: bd({ profile: 80, proof: 40, pipeline: 50, materials: 30, capital: 10 }),
    stage: 'establish_truth'
  });
  const pct = Object.fromEntries(hubs.map((h) => [h.key, h.pct])) as Record<HubKey, number>;
  assert.equal(pct.build, 60); // (80 + 40) / 2
  assert.equal(pct.source, 50); // pipeline
  assert.equal(pct.run, 30); // materials
  assert.equal(pct.drive, 10); // capital
});

test('deriveCockpit clamps and rounds out-of-range scores', () => {
  const hubs = deriveCockpit({
    readinessBreakdown: bd({ pipeline: 142, capital: -8 }),
    stage: 'source_lps'
  });
  const pct = Object.fromEntries(hubs.map((h) => [h.key, h.pct])) as Record<HubKey, number>;
  assert.equal(pct.source, 100);
  assert.equal(pct.drive, 0);
});

test('deriveCockpit marks exactly one current verb, per stage', () => {
  const cases: [LifecycleStage, HubKey][] = [
    ['establish_truth', 'build'],
    ['get_raise_ready', 'build'],
    ['source_lps', 'source'],
    ['convert_lps', 'source'],
    ['source_deals', 'source'],
    ['operate', 'run'],
    ['prove', 'drive']
  ];
  for (const [stage, expected] of cases) {
    const hubs = deriveCockpit({ readinessBreakdown: bd({}), stage });
    const current = hubs.filter((h) => h.isCurrent);
    assert.equal(current.length, 1, `${stage} should mark one current verb`);
    assert.equal(current[0].key, expected, `${stage} → ${expected}`);
  }
});
