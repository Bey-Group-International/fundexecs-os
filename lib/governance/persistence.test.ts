import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOV_POLICIES } from './config';
import {
  GOV_BODY_KINDS,
  policyById,
  sanitizeGovMembers,
  sanitizePolicyDecisions
} from './persistence';

test('policyById resolves every config policy and rejects unknowns', () => {
  for (const p of GOV_POLICIES) assert.equal(policyById(p.id)?.id, p.id);
  assert.equal(policyById('nope'), null);
});

test('sanitizePolicyDecisions keeps valid choices and falls back to the rec', () => {
  const pol = GOV_POLICIES[0]; // valuation: method (radio), cadence (radio)
  const out = sanitizePolicyDecisions(pol, {
    method: 'Cost less impairment',
    cadence: 'Weekly', // not an option → falls back to rec
    junk: 'dropped'
  });
  assert.equal(out.method, 'Cost less impairment');
  assert.equal(out.cadence, pol.rec.cadence);
  assert.ok(!('junk' in out));
});

test('sanitizePolicyDecisions handles multi decisions as valid subsets', () => {
  const pol = GOV_POLICIES.find((p) => p.decisions.some((d) => d.kind === 'multi'));
  assert.ok(pol, 'a multi-decision policy exists');
  const dec = pol.decisions.find((d) => d.kind === 'multi')!;
  const out = sanitizePolicyDecisions(pol, {
    [dec.key]: [dec.opts[0], 'not-an-option', dec.opts[1]].filter(Boolean)
  });
  const v = out[dec.key];
  assert.ok(Array.isArray(v));
  assert.ok(v.every((x) => dec.opts.includes(x)));
  assert.ok(!v.includes('not-an-option'));
});

test('sanitizePolicyDecisions of garbage input returns the recommendation', () => {
  const pol = GOV_POLICIES[0];
  const out = sanitizePolicyDecisions(pol, null);
  for (const dec of pol.decisions) {
    assert.deepEqual(out[dec.key], pol.rec[dec.key]);
  }
});

test('sanitizeGovMembers bounds and types the roster', () => {
  assert.deepEqual(sanitizeGovMembers('junk'), []);
  const out = sanitizeGovMembers([
    { id: 'a', name: 'Jane', role: 'Partner', you: true, carry: '20%' },
    { id: 'b', open: true, role: 'x'.repeat(500) },
    'not-an-object',
    { note: 7, role: null }
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'Jane');
  assert.equal(out[0].you, true);
  assert.equal(out[1].open, true);
  assert.equal(out[1].role.length, 200);
  assert.equal(out[2].role, 'Member');
  assert.equal(out[2].note, undefined);
});

test('sanitizeGovMembers caps roster size', () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: 'Member' }));
  assert.equal(sanitizeGovMembers(big).length, 12);
});

test('body kinds match the migration check constraint', () => {
  assert.deepEqual(
    [...GOV_BODY_KINDS],
    ['fund_mgmt', 'ic', 'advisory', 'lpac', 'capital_partners', 'legal_counsel']
  );
});
