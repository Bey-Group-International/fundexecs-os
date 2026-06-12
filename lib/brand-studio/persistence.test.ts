import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_BUILD, TR_RECOGNITION_OPTS } from './config';
import {
  BRAND_ASSET_IDS,
  PRESENCE_SETUP_IDS,
  isBrandAssetId,
  sanitizeBioSpec,
  sanitizeBrandKitSpec,
  sanitizeBrandStudioDoc,
  sanitizeCredentialsSpec
} from './persistence';

test('asset ids include the four copiloted builders', () => {
  assert.deepEqual([...BRAND_ASSET_IDS], ['bio', 'brandkit', 'website', 'credentials']);
  for (const id of BRAND_ASSET_IDS) assert.ok(isBrandAssetId(id));
  assert.equal(isBrandAssetId('nope'), false);
});

test('sanitizeBrandKitSpec keeps valid choices and falls back per field', () => {
  const out = sanitizeBrandKitSpec({
    palette: 'Forest & brass',
    logo: 'Hologram', // not an option → fallback
    voice: 'Direct',
    tagline: 'x'.repeat(500),
    aesthetic: 'Neon' // not an option → derived from voice
  });
  assert.equal(out.palette, 'Forest & brass');
  assert.equal(out.logo, 'Monogram');
  assert.equal(out.voice, 'Direct');
  assert.equal(out.tagline.length, 200);
  assert.equal(out.aesthetic, 'Institutional');
  assert.ok(!('junk' in out));
});

test('sanitizeBioSpec validates decisions and caps free text', () => {
  const out = sanitizeBioSpec({
    voice: 'Investor',
    length: 'Epic', // not an option → rec
    include: ['Thesis', 'Hacking'],
    years: '12',
    text: 'x'.repeat(5000),
    prior: 7 // wrong type → empty
  });
  assert.equal(out.voice, 'Investor');
  assert.equal(out.length, BRAND_BUILD.bio.rec.length);
  assert.deepEqual(out.include, ['Thesis']);
  assert.equal(out.text.length, 2000);
  assert.equal(out.prior, '');
});

test('sanitizeCredentialsSpec bounds deals and never trusts the client aggregate', () => {
  const out = sanitizeCredentialsSpec({
    deals: [
      { company: 'Real Co', year: '2020', multiple: '3.0', status: 'Realized' },
      { company: 'Open Co', year: '2021', multiple: '-5', status: 'Unrealized' },
      'junk',
      ...Array.from({ length: 40 }, (_, i) => ({ company: `Pad ${i}`, multiple: '1.0' }))
    ],
    edu: 'MBA, Wharton',
    recognition: [TR_RECOGNITION_OPTS[0], 'Fake honor'],
    agg: { count: 999, realized: 999, blended: '99.0', top: '99.0' } // hostile → recomputed
  });
  assert.ok(out.deals.length <= 20);
  assert.equal(out.deals[1].multiple, '', 'negative multiple rejected');
  assert.deepEqual(out.recognition, [TR_RECOGNITION_OPTS[0]]);
  assert.notEqual(out.agg.count, 999, 'aggregate recomputed, not trusted');
  assert.equal(
    out.agg.realized,
    out.deals.filter((d) => d.company && d.multiple && d.status === 'Realized').length
  );
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

test('presence setup ids cover credentials (legacy) + the presence items', () => {
  assert.ok(PRESENCE_SETUP_IDS.includes('credentials'));
  assert.ok(PRESENCE_SETUP_IDS.includes('domain'));
  assert.ok(PRESENCE_SETUP_IDS.includes('company'));
  assert.ok(PRESENCE_SETUP_IDS.includes('content'));
});
