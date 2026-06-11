import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATION_ITEMS,
  FORMATION_D0,
  F_REC,
  fileSteps,
  fundIdFor,
  itemUndecided,
  resultRows,
  type FormationData,
  type FormationKind
} from './config';

const KINDS: FormationKind[] = [
  'story',
  'structure',
  'terms',
  'ppm',
  'subscription',
  'regulatory',
  'bank'
];

test('every formation item maps to a unique kind with a doc + lead', () => {
  const kinds = new Set(FORMATION_ITEMS.map((i) => i.kind));
  assert.equal(kinds.size, FORMATION_ITEMS.length);
  for (const item of FORMATION_ITEMS) {
    assert.ok(item.id && item.name && item.who && item.doc);
    assert.ok(KINDS.includes(item.kind));
  }
});

test('itemUndecided counts deferred fields', () => {
  assert.equal(itemUndecided('story', FORMATION_D0), 0);
  assert.equal(itemUndecided('structure', { ...FORMATION_D0, entity: 'Undecided' }), 1);
  assert.equal(itemUndecided('terms', { ...FORMATION_D0, termsUndecided: true }), 1);
  assert.equal(
    itemUndecided('regulatory', {
      ...FORMATION_D0,
      exemption: 'Undecided',
      accred: 'Not sure yet — Earn decides'
    }),
    2
  );
  assert.equal(
    itemUndecided('bank', {
      ...FORMATION_D0,
      bank: 'Not sure yet — Earn decides',
      escrow: 'Not sure yet — Earn decides'
    }),
    2
  );
});

test('resultRows renders non-empty rows for every kind', () => {
  for (const kind of KINDS) {
    const rows = resultRows(kind, FORMATION_D0);
    assert.ok(rows.length > 0, `${kind} has no rows`);
    for (const [k, v] of rows) {
      assert.ok(k.length > 0 && v.length > 0, `${kind} row has empty cell`);
    }
  }
});

test('resultRows substitutes an Earn fallback for undecided fields', () => {
  const d: FormationData = { ...FORMATION_D0, entity: 'Undecided' };
  const entityRow = resultRows('structure', d).find(([k]) => k === 'Fund entity');
  assert.equal(entityRow?.[1], 'Delaware LP (Earn)');

  const bank: FormationData = { ...FORMATION_D0, escrow: 'Not sure yet — Earn decides' };
  const escrowRow = resultRows('bank', bank).find(([k]) => k === 'Escrow agent');
  assert.equal(escrowRow?.[1], 'Earn decides');
});

test('fileSteps always ends by logging to the record, and prepends undecided work', () => {
  for (const kind of KINDS) {
    const steps = fileSteps(kind, FORMATION_D0);
    assert.ok(steps.length >= 2);
    assert.equal(steps[steps.length - 1], 'Logging to your Chain of Trust');
  }
  const withUndecided = fileSteps('structure', { ...FORMATION_D0, entity: 'Undecided' });
  assert.match(withUndecided[0], /Finalizing 1 undecided item\b/);
});

test('F_REC covers every kind', () => {
  for (const kind of KINDS) {
    assert.ok(F_REC[kind], `missing recommendation for ${kind}`);
  }
});

test('fundIdFor builds a stable id and tolerates symbols/short names', () => {
  assert.equal(fundIdFor('Acme Capital'), 'FX-ACME-0001');
  assert.equal(fundIdFor('!!!'), 'FX-FUND-0001');
  assert.equal(fundIdFor(''), 'FX-FUND-0001');
});
