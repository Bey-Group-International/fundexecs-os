import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADV_0,
  CAP_0,
  confirmedMembers,
  FM_0,
  GOV_POLICIES,
  IC_MEMBERS_0,
  LEGAL_0,
  LEGAL_CANDIDATES,
  padRoster,
  POL_CTA,
  POL_STAGES,
  POL_TONE,
  policyDefaults,
  policyRows,
  policyStage,
  rosterRun,
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

test('starting rosters seed no fake people — only the operator and open seats', () => {
  for (const [label, roster] of [
    ['FM_0', FM_0],
    ['IC_MEMBERS_0', IC_MEMBERS_0],
    ['ADV_0', ADV_0],
    ['CAP_0', CAP_0],
    ['LEGAL_0', LEGAL_0]
  ] as const) {
    for (const m of roster) {
      assert.ok(m.you || m.open, `${label}: "${m.name}" seeds as a real member`);
    }
  }
});

test('confirmedMembers drops open and pending placeholders', () => {
  assert.deepEqual(confirmedMembers(ADV_0), []);
  assert.equal(confirmedMembers(FM_0).length, 1); // just the operator
  assert.ok(confirmedMembers(FM_0)[0].you);
});

test('padRoster pads confirmed members back to the seat layout', () => {
  // Empty advisory board reads as its two open seats.
  assert.deepEqual(padRoster(ADV_0, []), [...ADV_0]);
  // One confirmed advisor leaves the later open-seat template.
  const hale = { id: 'm-hale', name: 'Sir Reginald Hale', role: 'Industry Advisor' };
  const padded = padRoster(ADV_0, [hale]);
  assert.deepEqual(
    padded.map((m) => m.name),
    ['Sir Reginald Hale', 'Open seat']
  );
  assert.ok(padded[1].open);
  // A full (or overfull) roster gains no open seats.
  assert.equal(
    padRoster(
      FM_0,
      Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, role: 'Partner' }))
    ).some((m) => m.open),
    false
  );
});

test('rosterRun builds the per-body approve-loop copy', () => {
  const counsel = LEGAL_CANDIDATES[0];
  const run = rosterRun('legal_counsel', counsel);
  assert.ok(run.title.includes(counsel.name));
  assert.ok(run.draft.includes(counsel.role));
  assert.equal(run.steps.length, 4);
  // Fund management copy carries the carry split only when the bench has one.
  const withCarry = rosterRun('fund_mgmt', {
    name: 'A',
    role: 'Partner',
    note: 'n',
    carry: '25%'
  });
  assert.ok(withCarry.draft.includes('25% carry'));
  const noCarry = rosterRun('fund_mgmt', { name: 'A', role: 'Partner', note: 'n' });
  assert.ok(!noCarry.draft.includes('undefined'));
});

test('policyStage walks To do → Drafting → Active, adopted winning', () => {
  assert.equal(policyStage('valuation', {}, {}), 'todo');
  assert.equal(policyStage('valuation', {}, { valuation: {} }), 'drafting');
  assert.equal(policyStage('valuation', { valuation: {} }, {}), 'active');
  assert.equal(policyStage('valuation', { valuation: {} }, { valuation: {} }), 'active');
});

test('every policy stage has a label, tone and call to action', () => {
  for (const stage of ['todo', 'drafting', 'active'] as const) {
    assert.ok(POL_STAGES[stage]);
    assert.ok(POL_TONE[stage]);
    assert.ok(POL_CTA[stage]);
  }
  assert.equal(POL_CTA.todo, 'Draft');
  assert.equal(POL_CTA.drafting, 'Adopt');
  assert.equal(POL_CTA.active, 'View');
});
