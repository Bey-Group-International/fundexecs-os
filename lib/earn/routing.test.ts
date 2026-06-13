import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAsk, specialistLabel, SPECIALIST_LABELS, EARN_COO_SLUG } from './routing';
import { BRAINS } from '@/lib/ai/brains';

/* ----------------------------------------------------------------------------
 * Specialist-routing regression suite.
 *
 * Locks the deterministic classifier the streaming brain uses to attribute each
 * ask to a desk (and to load that desk's prior ledger outcomes as context).
 * These guard the routing the operator feels — a mis-route shows the wrong desk
 * and loads the wrong memory.
 * -------------------------------------------------------------------------- */

test('routes the core fundraise asks to the right desks', () => {
  assert.equal(routeAsk('Draft my Q2 LP letter'), 'investor-relations');
  assert.equal(routeAsk('Who should I raise from next?'), 'capital-raiser');
  assert.equal(routeAsk('Sequence the next steps to close'), 'master-workflow');
  assert.equal(routeAsk('Find me a co-investor for this deal'), 'capital-connector');
  assert.equal(routeAsk('Are there any compliance red flags?'), 'legal-admin');
  assert.equal(routeAsk('Source three on-thesis deals'), 'deal-sourcer');
  assert.equal(routeAsk('Pressure-test my investment thesis'), 'executive-advisor');
});

test('falls back to Earn for unmatched or empty asks', () => {
  assert.equal(routeAsk('Tell me something interesting'), EARN_COO_SLUG);
  assert.equal(routeAsk(''), EARN_COO_SLUG);
  assert.equal(routeAsk(null), EARN_COO_SLUG);
  assert.equal(routeAsk(undefined), EARN_COO_SLUG);
});

test('every routable slug and label is a real brain', () => {
  const slugs = new Set(BRAINS.map((b) => b.slug));
  for (const slug of Object.keys(SPECIALIST_LABELS)) {
    assert.ok(slugs.has(slug), `label slug "${slug}" is not a real brain`);
    assert.ok(specialistLabel(slug).length > 0, `slug "${slug}" needs a label`);
  }
});

test('specialistLabel defaults to Earn for unknown slugs', () => {
  assert.equal(specialistLabel('nope'), 'Earn');
  assert.equal(specialistLabel(EARN_COO_SLUG), 'Earn');
});
