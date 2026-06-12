import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADV_0,
  ADV_CANDIDATES,
  CAP_0,
  CAP_CANDIDATES,
  FM_0,
  FM_CANDIDATES,
  GOV_POLICIES,
  IC_CANDIDATES,
  IC_MEMBERS_0,
  LEGAL_0,
  LEGAL_CANDIDATES,
  LPAC_0,
  POL_STAGES,
  POL_TONE,
  bodyRunCopy,
  policyDefaults,
  policyRows,
  policyStage,
  type AddableBodyKind,
  type GovPolicy,
  type PolicyValue
} from './config';

test('bodyRunCopy gives every addable body a full approve-loop run', () => {
  const benches: Record<AddableBodyKind, (typeof FM_CANDIDATES)[number]> = {
    fund_mgmt: FM_CANDIDATES[0],
    ic: IC_CANDIDATES[0],
    advisory: ADV_CANDIDATES[0],
    capital_partners: CAP_CANDIDATES[0],
    legal_counsel: LEGAL_CANDIDATES[0]
  };
  for (const [kind, cand] of Object.entries(benches) as [
    AddableBodyKind,
    (typeof FM_CANDIDATES)[number]
  ][]) {
    const copy = bodyRunCopy(kind, cand);
    assert.ok(copy.title.includes(cand.name), `${kind} title names the candidate`);
    assert.equal(copy.steps.length, 4, `${kind} has the prototype's 4 run steps`);
    assert.equal(copy.steps.at(-1), 'Prepare for your approval');
    assert.ok(copy.draftTitle.includes(cand.name));
    assert.ok(copy.draft.includes('Approve to'), `${kind} draft frames the approve moment`);
  }
  const withCarry = bodyRunCopy('fund_mgmt', FM_CANDIDATES[0]);
  assert.ok(
    withCarry.draft.includes(FM_CANDIDATES[0].carry as string),
    'GP draft carries the carry'
  );
  const noCarry = bodyRunCopy('fund_mgmt', { name: 'A', role: 'Partner', note: 'n' });
  assert.ok(!noCarry.draft.includes('undefined'), 'no carry → no undefined in copy');
});

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

test('policy stage progression: To do → Drafting → Active, adoption wins', () => {
  assert.equal(policyStage(false, false), 'todo');
  assert.equal(policyStage(false, true), 'drafting');
  assert.equal(policyStage(true, false), 'active');
  assert.equal(policyStage(true, true), 'active');
  for (const stage of ['todo', 'drafting', 'active'] as const) {
    assert.ok(POL_STAGES[stage], `${stage} has a label`);
    assert.ok(POL_TONE[stage], `${stage} has a tone`);
  }
});

test('starting rosters never present seeded people as real data', () => {
  for (const [kind, roster] of Object.entries({
    fund_mgmt: FM_0,
    ic: IC_MEMBERS_0,
    advisory: ADV_0,
    capital_partners: CAP_0,
    legal_counsel: LEGAL_0,
    lpac: LPAC_0
  })) {
    for (const m of roster) {
      assert.ok(
        m.you || m.open || m.pending,
        `${kind}: "${m.name ?? m.role}" reads as a real member before the operator confirmed anyone`
      );
    }
  }
});

test('every roster with open seats has a candidate bench of suggestions', () => {
  for (const [kind, { roster, bench }] of Object.entries({
    fund_mgmt: { roster: FM_0, bench: FM_CANDIDATES },
    ic: { roster: IC_MEMBERS_0, bench: IC_CANDIDATES },
    advisory: { roster: ADV_0, bench: ADV_CANDIDATES },
    capital_partners: { roster: CAP_0, bench: CAP_CANDIDATES },
    legal_counsel: { roster: LEGAL_0, bench: LEGAL_CANDIDATES }
  })) {
    assert.ok(
      roster.some((m) => m.open),
      `${kind} starts with an open seat`
    );
    assert.ok(bench.length > 0, `${kind} has bench suggestions`);
    for (const c of bench) {
      assert.ok(c.name && c.role && c.note, `${kind} bench entry is fully described`);
    }
  }
});
