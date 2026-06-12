import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAND_BUILD,
  BRAND_ITEM_NAME,
  BRAND_STAGES,
  BRAND_TONE,
  PALETTES,
  brandDefaults,
  brandRows,
  brandStage,
  buildSteps,
  paletteFor,
  type BrandBuildCfg
} from './config';

test('brand stage progression: To do → Produced → Live, published wins', () => {
  assert.equal(brandStage(false, false), 'todo');
  assert.equal(brandStage(false, true), 'produced');
  assert.equal(brandStage(true, false), 'live');
  assert.equal(brandStage(true, true), 'live');
  for (const stage of ['todo', 'produced', 'live'] as const) {
    assert.ok(BRAND_STAGES[stage], `${stage} has a label`);
    assert.ok(BRAND_TONE[stage], `${stage} has a tone`);
  }
});

test('every brand builder recommendation uses valid options for its decisions', () => {
  for (const [id, cfg] of Object.entries(BRAND_BUILD)) {
    assert.ok(BRAND_ITEM_NAME[id], `missing item name for ${id}`);
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

test('brandDefaults deep-copies array values', () => {
  const cfg = BRAND_BUILD.bio;
  const d = brandDefaults(cfg);
  (d.include as string[]).push('Tampered');
  assert.ok(!(cfg.rec.include as string[]).includes('Tampered'));
});

test('brandRows joins multi values and handles empties', () => {
  const cfg: BrandBuildCfg = BRAND_BUILD.website;
  assert.equal(
    brandRows(cfg, { type: 'One-pager', sections: [], gate: 'Public only' })[1][1],
    'None'
  );
  assert.equal(
    brandRows(cfg, { type: 'One-pager', sections: ['Thesis', 'Team'], gate: 'Public only' })[1][1],
    'Thesis, Team'
  );
});

test('buildSteps ends by publishing to the workspace', () => {
  const steps = buildSteps('Brand kit');
  assert.ok(steps.length >= 2);
  assert.match(steps[1], /brand kit/);
  assert.match(steps[steps.length - 1], /Publish to your workspace/);
});

test('every palette has exactly three swatches; paletteFor falls back to navy & gold', () => {
  for (const [name, swatches] of Object.entries(PALETTES)) {
    assert.equal(swatches.length, 3, `${name} should have 3 swatches`);
    for (const c of swatches) assert.match(c, /^#[0-9a-fA-F]{6}$/);
  }
  assert.deepEqual(paletteFor('Forest & brass'), PALETTES['Forest & brass']);
  assert.deepEqual(paletteFor(undefined), PALETTES['Navy & gold']);
  assert.deepEqual(paletteFor('nope'), PALETTES['Navy & gold']);
});
