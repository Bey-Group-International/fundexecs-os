import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRC_NOUN, SRC_NOUN_PLURAL, SRC_TITLE, sourceGroupFor } from './vocab';

test('sourceGroupFor maps every org_type to its prototype group', () => {
  assert.equal(sourceGroupFor('fund'), 'fund');
  assert.equal(sourceGroupFor('operator'), 'fund');
  assert.equal(sourceGroupFor('lp'), 'capital');
  assert.equal(sourceGroupFor('capital_provider'), 'capital');
  assert.equal(sourceGroupFor('service_provider'), 'service');
  assert.equal(sourceGroupFor('partner'), 'service');
});

test('sourceGroupFor defaults to fund for missing/unknown types', () => {
  assert.equal(sourceGroupFor(null), 'fund');
  assert.equal(sourceGroupFor(undefined), 'fund');
  assert.equal(sourceGroupFor(''), 'fund');
  assert.equal(sourceGroupFor('something_else'), 'fund');
});

test('vocabulary matches the prototype SRC_TITLE / SRC_NOUN', () => {
  assert.equal(SRC_TITLE.fund, 'LP Capital Map');
  assert.equal(SRC_TITLE.capital, 'Allocation targets');
  assert.equal(SRC_TITLE.service, 'Client pipeline');
  assert.equal(SRC_NOUN.fund, 'LP');
  assert.equal(SRC_NOUN.capital, 'target');
  assert.equal(SRC_NOUN.service, 'client');
  assert.deepEqual(Object.keys(SRC_TITLE), Object.keys(SRC_NOUN));
  assert.deepEqual(Object.keys(SRC_TITLE), Object.keys(SRC_NOUN_PLURAL));
});
