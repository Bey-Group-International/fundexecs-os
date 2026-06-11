import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_BUILD } from './config';
import {
  BRAND_ASSET_IDS,
  PRESENCE_SETUP_IDS,
  isBrandAssetId,
  sanitizeBrandSpec,
  sanitizeBrandStudioDoc
} from './persistence';

test('asset ids align with the builder config', () => {
  for (const id of BRAND_ASSET_IDS) {
    assert.ok(isBrandAssetId(id));
    assert.ok(BRAND_BUILD[id], `${id} has a builder config`);
  }
  assert.equal(isBrandAssetId('credentials'), false);
  assert.equal(isBrandAssetId('nope'), false);
});

test('sanitizeBrandSpec keeps valid choices and falls back to the rec', () => {
  const out = sanitizeBrandSpec('brandkit', {
    palette: 'Forest & brass',
    aesthetic: 'Neon', // not an option → rec
    voice: 'Direct',
    junk: 1
  });
  assert.equal(out.palette, 'Forest & brass');
  assert.equal(out.aesthetic, BRAND_BUILD.brandkit.rec.aesthetic);
  assert.equal(out.voice, 'Direct');
  assert.ok(!('junk' in out));
});

test('sanitizeBrandStudioDoc round-trips a clean doc and drops junk', () => {
  const doc = sanitizeBrandStudioDoc({
    built: { bio: { voice: 'Investor' }, hacker: { x: 1 } },
    presence: ['credentials', 'domain', 'domain', 'fake-id', 42]
  });
  assert.deepEqual(Object.keys(doc.built), ['bio']);
  assert.equal(doc.built.bio?.voice, 'Investor');
  assert.deepEqual(doc.presence, ['credentials', 'domain']);
});

test('sanitizeBrandStudioDoc of garbage is the empty doc', () => {
  assert.deepEqual(sanitizeBrandStudioDoc(null), { built: {}, presence: [] });
  assert.deepEqual(sanitizeBrandStudioDoc('x'), { built: {}, presence: [] });
});

test('presence setup ids cover credentials + the presence items', () => {
  assert.ok(PRESENCE_SETUP_IDS.includes('credentials'));
  assert.ok(PRESENCE_SETUP_IDS.includes('domain'));
  assert.ok(PRESENCE_SETUP_IDS.includes('company'));
  assert.ok(PRESENCE_SETUP_IDS.includes('content'));
});
