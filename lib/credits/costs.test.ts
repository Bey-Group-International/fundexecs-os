import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_COST,
  asPaidIntegration,
  asPlan,
  canUseIntegration,
  costOf,
  lowBalanceThreshold,
  MAX_ACTION_COST,
  nextPlanUp,
  MONTHLY_GRANT,
  PAID_INTEGRATION_ACTION,
  PAID_INTEGRATIONS,
  PLANS
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
  for (const [action, cost] of Object.entries(ACTION_COST)) {
    assert.ok(Number.isFinite(cost), `cost for ${action} must be finite`);
    assert.ok(cost >= 0, `cost for ${action} must be non-negative`);
  }
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
  for (const plan of PLANS)
    assert.ok(MONTHLY_GRANT[plan] > 0, `grant for ${plan} must be positive`);
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

test('every paid integration maps to a real, positive-cost metered action', () => {
  for (const provider of PAID_INTEGRATIONS) {
    const action = PAID_INTEGRATION_ACTION[provider];
    assert.ok(action, `${provider} must map to an action`);
    assert.ok(costOf(action) > 0, `${provider}'s action ${action} must cost credits`);
  }
});

test('asPaidIntegration narrows known providers and rejects owned/unknown ones', () => {
  assert.equal(asPaidIntegration('apollo'), 'apollo');
  assert.equal(asPaidIntegration('granola'), 'granola');
  for (const owned of ['gmail', 'google_calendar', 'slack', '', 'APOLLO']) {
    assert.equal(asPaidIntegration(owned), null, `expected null for: ${owned}`);
  }
});

test('MAX_ACTION_COST tracks the priciest metered action', () => {
  assert.equal(MAX_ACTION_COST, Math.max(...Object.values(ACTION_COST)));
  // The heaviest run today is the diligence run.
  assert.equal(MAX_ACTION_COST, costOf('diligence_run'));
});

test('lowBalanceThreshold is the larger of max action cost and 10% of the grant', () => {
  // Free floors on the priciest action — its 10% (5) is below it, so you must
  // still be able to run the big thing before we warn.
  assert.equal(lowBalanceThreshold('free'), MAX_ACTION_COST);
  // Every richer plan's 10% already clears the floor, so it scales with the grant.
  assert.equal(lowBalanceThreshold('standard'), Math.ceil(MONTHLY_GRANT.standard * 0.1));
  assert.equal(lowBalanceThreshold('pro'), Math.ceil(MONTHLY_GRANT.pro * 0.1));
  assert.equal(lowBalanceThreshold('institutional'), Math.ceil(MONTHLY_GRANT.institutional * 0.1));
  // Never below the priciest action, for any plan.
  for (const plan of PLANS) {
    assert.ok(lowBalanceThreshold(plan) >= MAX_ACTION_COST, `threshold for ${plan} too low`);
  }
});

test('nextPlanUp walks the ladder and tops out at institutional', () => {
  assert.equal(nextPlanUp('free'), 'standard');
  assert.equal(nextPlanUp('standard'), 'pro');
  assert.equal(nextPlanUp('pro'), 'institutional');
  assert.equal(nextPlanUp('institutional'), null);
});
