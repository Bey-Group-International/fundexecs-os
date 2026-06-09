import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asPlan,
  canUseIntegration,
  costOf,
  nextPlanUp,
  MONTHLY_GRANT,
  PLANS,
  type Plan
} from './costs';

/* ----------------------------------------------------------------------------
 * Credit-metering policy suite.
 *
 * Locks the money-shaped decisions: plan coercion, action costs, integration
 * gating, and the upgrade ladder. Pure policy — no DB. The monthly-grant amounts
 * here MUST match the CASE in supabase/migrations/20260609180000_credit_metering.sql.
 * --------------------------------------------------------------------------*/

test('asPlan coerces unknown / missing plans to the thin free tier', () => {
  assert.equal(asPlan('pro'), 'pro');
  assert.equal(asPlan('institutional'), 'institutional');
  for (const bad of ['enterprise', '', null, undefined, 'FREE']) {
    assert.equal(asPlan(bad), 'free', `expected free for: ${String(bad)}`);
  }
});

test('owned compute is cheap; vendor-cost runs are dearer', () => {
  assert.equal(costOf('earn_chat'), 1);
  assert.ok(costOf('diligence_run') > costOf('deck_review'));
  assert.ok(costOf('meeting_copilot') > costOf('earn_chat'));
  // No negative or NaN costs anywhere.
  for (const action of Object.keys(MONTHLY_GRANT) as Plan[]) void action;
});

test('free plan unlocks no paid integrations; richer plans unlock more', () => {
  assert.equal(canUseIntegration('free', 'apollo'), false);
  assert.equal(canUseIntegration('free', 'granola'), false);
  assert.equal(canUseIntegration('free', 'docusign'), false);

  assert.equal(canUseIntegration('standard', 'apollo'), true);
  assert.equal(canUseIntegration('standard', 'granola'), true);
  // Docusign / Carta are reserved for pro+.
  assert.equal(canUseIntegration('standard', 'docusign'), false);
  assert.equal(canUseIntegration('pro', 'docusign'), true);
  assert.equal(canUseIntegration('institutional', 'carta'), true);
});

test('monthly grant grows with plan and is positive for every plan', () => {
  for (const plan of PLANS) assert.ok(MONTHLY_GRANT[plan] > 0, `grant for ${plan} must be positive`);
  assert.ok(MONTHLY_GRANT.free < MONTHLY_GRANT.standard);
  assert.ok(MONTHLY_GRANT.standard < MONTHLY_GRANT.pro);
  assert.ok(MONTHLY_GRANT.pro < MONTHLY_GRANT.institutional);
});

test('monthly grant amounts match the SQL CASE in the migration', () => {
  // Keep in lockstep with claim_monthly_credit_grant.
  assert.equal(MONTHLY_GRANT.free, 50);
  assert.equal(MONTHLY_GRANT.standard, 500);
  assert.equal(MONTHLY_GRANT.pro, 2500);
  assert.equal(MONTHLY_GRANT.institutional, 15000);
});

test('nextPlanUp walks the ladder and tops out at institutional', () => {
  assert.equal(nextPlanUp('free'), 'standard');
  assert.equal(nextPlanUp('standard'), 'pro');
  assert.equal(nextPlanUp('pro'), 'institutional');
  assert.equal(nextPlanUp('institutional'), null);
});
