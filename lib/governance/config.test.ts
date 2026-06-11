import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOV_POLICIES,
  policyDefaults,
  policyRows,
  type GovPolicy,
  type PolicyValue
} from './config';

test('every policy has decisions and a recommendation covering each key', () => {
  for (const pol of GOV_POLICIES) {
    assert.ok(pol.id && pol.name && pol.icon && pol.intro && pol.recText);
    assert.ok(pol.decisions.length > 0, `${pol.id} has no decisions`);
    for (const dec of pol.decisions) {
      assert.ok(dec.opts.length > 0, `${pol.id}.${dec.key} has no options`);
      assert.ok(dec.key in pol.rec, `${pol.id} rec missing ${dec.key}`);
    }
  }
});

test('recommended values are valid options for their decision', () => {
  for (const pol of GOV_POLICIES) {
    for (const dec of pol.decisions) {
      const v = pol.rec[dec.key];
      if (Array.isArray(v)) {
        for (const item of v)
          assert.ok(dec.opts.includes(item), `${pol.id}.${dec.key}: ${item} not an option`);
      } else {
        assert.ok(dec.opts.includes(v as string), `${pol.id}.${dec.key}: ${v} not an option`);
      }
    }
  }
});

test('policyDefaults returns an independent (deep) copy of array values', () => {
  const pol = GOV_POLICIES.find((p) => p.id === 'compliance') as GovPolicy;
  const d = policyDefaults(pol);
  (d.scope as string[]).push('Tampered');
  assert.ok(!(pol.rec.scope as string[]).includes('Tampered'), 'mutated the source rec');
});

test('policyRows joins multi values and handles empty selections', () => {
  const pol = GOV_POLICIES.find((p) => p.id === 'compliance') as GovPolicy;
  const empty: Record<string, PolicyValue> = { scope: [] };
  assert.deepEqual(policyRows(pol, empty), [['Include', 'None']]);
  const filled = policyRows(pol, { scope: ['Personal trading', 'Recordkeeping'] });
  assert.equal(filled[0][1], 'Personal trading, Recordkeeping');
});
