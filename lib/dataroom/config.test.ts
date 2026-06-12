import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LINK_EXPIRY,
  LINK_EXPIRY_PRESETS,
  MATERIAL_BUILD,
  MAT_DOCS,
  MAT_LABEL,
  MAT_META,
  buildSteps,
  expiryTimestamp,
  linkToken,
  materialDefaults,
  materialRows,
  type MaterialBuildCfg
} from './config';

test('every material doc has meta, a label, and a copiloted builder', () => {
  for (const id of MAT_DOCS) {
    assert.ok(MAT_META[id], `missing meta for ${id}`);
    assert.ok(MAT_LABEL[id], `missing label for ${id}`);
    assert.ok(MATERIAL_BUILD[id], `missing builder for ${id}`);
  }
});

test('each builder recommendation uses valid options for its decisions', () => {
  for (const id of MAT_DOCS) {
    const cfg = MATERIAL_BUILD[id];
    for (const dec of cfg.decisions) {
      assert.ok(dec.key in cfg.rec, `${id} rec missing ${dec.key}`);
      const v = cfg.rec[dec.key];
      if (Array.isArray(v)) {
        for (const item of v)
          assert.ok(dec.opts.includes(item), `${id}.${dec.key}: ${item} not an option`);
      } else {
        assert.ok(dec.opts.includes(v as string), `${id}.${dec.key}: ${v} not an option`);
      }
    }
  }
});

test('materialDefaults deep-copies array values', () => {
  const cfg = MATERIAL_BUILD.deck;
  const d = materialDefaults(cfg);
  (d.sections as string[]).push('Tampered');
  assert.ok(!(cfg.rec.sections as string[]).includes('Tampered'));
});

test('materialRows joins multi values and handles empties', () => {
  const cfg: MaterialBuildCfg = MATERIAL_BUILD.ddq;
  assert.deepEqual(materialRows(cfg, { sets: [] }), [['Question sets', 'None']]);
  assert.equal(
    materialRows(cfg, { sets: ['Strategy', 'Operations'] })[0][1],
    'Strategy, Operations'
  );
});

test('buildSteps ends by placing the doc in its folder', () => {
  const steps = buildSteps('deck');
  assert.ok(steps.length >= 2);
  assert.match(steps[steps.length - 1], /Fund Overview/);
});

test('expiryTimestamp resolves presets and never defaults to "never"', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');
  assert.equal(expiryTimestamp('30d', now), '2026-07-12T00:00:00.000Z');
  assert.equal(expiryTimestamp('90d', now), '2026-09-10T00:00:00.000Z');
  assert.equal(expiryTimestamp('never', now), null);
  // Unknown ids fall back to the default preset, not to no-expiry.
  assert.equal(expiryTimestamp('garbage', now), expiryTimestamp(DEFAULT_LINK_EXPIRY, now));
  assert.ok(LINK_EXPIRY_PRESETS.some((p) => p.id === DEFAULT_LINK_EXPIRY));
});

test('linkToken is deterministic under a seeded rng, with two 4-char segments', () => {
  const seq = [0.123456, 0.789012, 0.345678, 0.901234];
  const seeded = () => {
    let i = 0;
    return () => seq[i++ % seq.length];
  };
  const tok = linkToken(seeded());
  // Same seed → same token (determinism), and a stable 4-4 base-36 shape.
  assert.equal(linkToken(seeded()), tok);
  assert.match(tok, /^[a-z0-9]{4}-[a-z0-9]{4}$/);
});
