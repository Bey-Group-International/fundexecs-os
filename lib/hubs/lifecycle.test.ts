import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFECYCLE_STAGES,
  READINESS_WEIGHTS,
  type ReadinessDimension,
  type ReadinessDimensionScore
} from '@/lib/lifecycle';
import { HUB_IDS, HUB_META, centerHub, hubContent, hubMeta, hubReadiness } from './lifecycle';

const ORDER: ReadinessDimension[] = ['profile', 'proof', 'materials', 'pipeline', 'capital'];

/** Build a breakdown from a partial score map (missing dims default to 0). */
function bd(scores: Partial<Record<ReadinessDimension, number>>): ReadinessDimensionScore[] {
  return ORDER.map((dimension) => {
    const score = scores[dimension] ?? 0;
    const weight = READINESS_WEIGHTS[dimension];
    return { dimension, score, weight, contribution: (score * weight) / 100 };
  });
}

/* ── hubReadiness ──────────────────────────────────────────────────────── */

test('hubReadiness maps the readiness dimensions onto the four verbs', () => {
  const pct = hubReadiness(
    bd({ profile: 80, materials: 40, pipeline: 55, proof: 30, capital: 10 })
  );
  assert.deepEqual(pct, { build: 60, source: 55, run: 30, execute: 10 });
});

test('hubReadiness reads a zero state as all-zero, never NaN', () => {
  assert.deepEqual(hubReadiness([]), { build: 0, source: 0, run: 0, execute: 0 });
});

test('hubReadiness clamps to 0–100', () => {
  const pct = hubReadiness(bd({ profile: 150, materials: 150, pipeline: -5 }));
  assert.equal(pct.build, 100);
  assert.equal(pct.source, 0);
});

/* ── centerHub ─────────────────────────────────────────────────────────── */

test('centerHub covers every lifecycle stage', () => {
  for (const stage of LIFECYCLE_STAGES) {
    assert.ok(HUB_IDS.includes(centerHub(stage)), `${stage} maps to a hub`);
  }
});

test('centerHub maps the journey onto the verbs', () => {
  assert.equal(centerHub('establish_truth'), 'build');
  assert.equal(centerHub('get_raise_ready'), 'build');
  assert.equal(centerHub('source_lps'), 'source');
  assert.equal(centerHub('source_deals'), 'source');
  assert.equal(centerHub('operate'), 'run');
  assert.equal(centerHub('convert_lps'), 'execute');
  assert.equal(centerHub('prove'), 'execute');
});

/* ── vocabulary integrity ──────────────────────────────────────────────── */

test('hub meta and content stay aligned for every hub and member type', () => {
  assert.deepEqual(
    HUB_META.map((m) => m.id),
    [...HUB_IDS]
  );
  for (const id of HUB_IDS) {
    assert.equal(hubMeta(id).href, `/${id}`);
    for (const group of ['fund', 'capital', 'service'] as const) {
      const content = hubContent(group, id);
      assert.ok(content.blurb.length > 0);
      assert.equal(content.modules.length, 4);
      for (const mod of content.modules) {
        assert.ok(mod.icon.length > 0, `${group}/${id}/${mod.label} has an icon`);
        assert.ok(mod.meta.length > 0, `${group}/${id}/${mod.label} has a meta line`);
      }
    }
  }
});
