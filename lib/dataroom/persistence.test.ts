import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_BUILD, MAT_DOCS } from './config';
import {
  MATERIAL_DB_KIND,
  defaultMaterialSpec,
  isMaterialId,
  materialIdForDbKind,
  sanitizeMaterialSpec
} from './persistence';

test('every flow material maps to a DB kind and back', () => {
  for (const id of MAT_DOCS) {
    assert.ok(isMaterialId(id), `${id} is a material id`);
    const kind = MATERIAL_DB_KIND[id];
    assert.ok(kind, `${id} has a DB kind`);
    assert.equal(materialIdForDbKind(kind), id);
  }
  assert.equal(materialIdForDbKind('ic_memo'), null);
  assert.equal(isMaterialId('nope'), false);
});

test('sanitizeMaterialSpec keeps valid choices and falls back to the rec', () => {
  const out = sanitizeMaterialSpec('deck', {
    emphasis: 'Team',
    length: 'XXL', // not an option → rec
    sections: ['Terms', 'Not a section'],
    junk: true
  });
  assert.equal(out.emphasis, 'Team');
  assert.equal(out.length, MATERIAL_BUILD.deck.rec.length);
  assert.deepEqual(out.sections, ['Terms']);
  assert.ok(!('junk' in out));
});

test('sanitizeMaterialSpec of garbage returns the recommendation', () => {
  for (const id of MAT_DOCS) {
    assert.deepEqual(sanitizeMaterialSpec(id, null), defaultMaterialSpec(id));
  }
  assert.deepEqual(sanitizeMaterialSpec('unknown', { a: 1 }), {});
});
