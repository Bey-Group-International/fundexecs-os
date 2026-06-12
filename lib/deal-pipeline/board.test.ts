import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterDeals, sortDeals, type BoardDeal } from './board';

const STAGE_KEYS = ['visitor', 'prospect', 'qualified', 'meeting', 'diligence'];

function deal(over: Partial<BoardDeal> & { id: string }): BoardDeal {
  return {
    name: over.id,
    note: '',
    stage: 'prospect',
    amount: null,
    fit: 50,
    ...over
  };
}

test('filterDeals: empty filters pass everything through', () => {
  const deals = [deal({ id: 'a' }), deal({ id: 'b' })];
  assert.deepEqual(filterDeals(deals, { query: '', stage: '' }), deals);
});

test('filterDeals: query matches name and note, case-insensitive', () => {
  const deals = [
    deal({ id: 'a', name: 'Northwind Logistics' }),
    deal({ id: 'b', name: 'Acme', note: 'DDQ in review' }),
    deal({ id: 'c', name: 'Umbrella' })
  ];
  assert.deepEqual(
    filterDeals(deals, { query: 'northwind', stage: '' }).map((d) => d.id),
    ['a']
  );
  assert.deepEqual(
    filterDeals(deals, { query: 'ddq', stage: '' }).map((d) => d.id),
    ['b']
  );
  assert.deepEqual(filterDeals(deals, { query: 'zzz', stage: '' }), []);
});

test('filterDeals: stage pin combines with query', () => {
  const deals = [
    deal({ id: 'a', name: 'Acme One', stage: 'diligence' }),
    deal({ id: 'b', name: 'Acme Two', stage: 'prospect' })
  ];
  assert.deepEqual(
    filterDeals(deals, { query: 'acme', stage: 'diligence' }).map((d) => d.id),
    ['a']
  );
});

test('sortDeals: default stage order is furthest first, then fit', () => {
  const deals = [
    deal({ id: 'low-fit-late', stage: 'diligence', fit: 60 }),
    deal({ id: 'early', stage: 'visitor', fit: 99 }),
    deal({ id: 'high-fit-late', stage: 'diligence', fit: 90 })
  ];
  assert.deepEqual(
    sortDeals(deals, 'stage', STAGE_KEYS).map((d) => d.id),
    ['high-fit-late', 'low-fit-late', 'early']
  );
});

test('sortDeals: size puts unsized deals last and does not mutate input', () => {
  const deals = [
    deal({ id: 'unsized', amount: null }),
    deal({ id: 'small', amount: 1_000 }),
    deal({ id: 'big', amount: 9_000 })
  ];
  const sorted = sortDeals(deals, 'size', STAGE_KEYS);
  assert.deepEqual(
    sorted.map((d) => d.id),
    ['big', 'small', 'unsized']
  );
  assert.equal(deals[0].id, 'unsized');
});

test('sortDeals: fit desc with name tie-break, name A–Z', () => {
  const deals = [
    deal({ id: 'b', name: 'Beta', fit: 80 }),
    deal({ id: 'a', name: 'Alpha', fit: 80 }),
    deal({ id: 'c', name: 'Gamma', fit: 95 })
  ];
  assert.deepEqual(
    sortDeals(deals, 'fit', STAGE_KEYS).map((d) => d.name),
    ['Gamma', 'Alpha', 'Beta']
  );
  assert.deepEqual(
    sortDeals(deals, 'name', STAGE_KEYS).map((d) => d.name),
    ['Alpha', 'Beta', 'Gamma']
  );
});
