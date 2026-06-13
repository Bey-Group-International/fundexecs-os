import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasonLabel } from './labels';

/* ----------------------------------------------------------------------------
 * Ledger reason-label suite. Locks the wallet ledger's human labels: exact
 * action ids, scope-suffixed sources (monthly grant, referrals, gifts), and the
 * title-cased fallback so an unmapped reason still reads cleanly.
 * --------------------------------------------------------------------------*/

test('known metered actions get friendly labels', () => {
  assert.equal(reasonLabel('earn_chat'), 'Earn chat');
  assert.equal(reasonLabel('diligence_run'), 'Diligence run');
  assert.equal(reasonLabel('team_task_run'), 'Team automation');
  assert.equal(reasonLabel('apollo_enrich'), 'Apollo enrichment');
});

test('scope-suffixed sources match by prefix', () => {
  assert.equal(reasonLabel('monthly_grant:2026-06'), 'Monthly grant');
  assert.equal(reasonLabel('referral:abc123'), 'Referral reward');
  assert.equal(reasonLabel('gift:xyz'), 'Gift credits');
});

test('unmapped reasons fall back to a clean title case', () => {
  assert.equal(reasonLabel('some_new_reason'), 'Some new reason');
  assert.equal(reasonLabel('manual-adjustment:42'), 'Manual adjustment');
});

test('missing reason never throws', () => {
  assert.equal(reasonLabel(null), 'Adjustment');
  assert.equal(reasonLabel(undefined), 'Adjustment');
  assert.equal(reasonLabel(''), 'Adjustment');
});
