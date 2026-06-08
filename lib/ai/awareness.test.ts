import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, lastTouch } from './awareness';

/* ----------------------------------------------------------------------------
 * Workspace-awareness formatting regression suite. These lock the compact,
 * name-free phrasings Earn places in its grounding blocks — pure functions,
 * no Supabase client required.
 * --------------------------------------------------------------------------*/

test('money renders compact, sign-safe figures', () => {
  assert.equal(money(0), '$0');
  assert.equal(money(-5_000), '$0');
  assert.equal(money(Number.NaN), '$0');
  assert.equal(money(999), '$999');
  assert.equal(money(1_500), '$2K');
  assert.equal(money(850_000), '$850K');
  assert.equal(money(1_000_000), '$1.0M');
  assert.equal(money(4_200_000), '$4.2M');
  assert.equal(money(12_000_000), '$12M'); // ≥ $10M drops the decimal
});

/** ISO timestamp `n` days before now. */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

test('lastTouch returns null for missing or invalid input', () => {
  assert.equal(lastTouch(null), null);
  assert.equal(lastTouch('not-a-date'), null);
});

test('lastTouch buckets recency with floor (never rounds up into a future bucket)', () => {
  assert.equal(lastTouch(daysAgoIso(0)), 'last touch today');
  // 1.6 days floors to 1 → "yesterday" (Math.round would wrongly say "2 days ago").
  assert.equal(lastTouch(daysAgoIso(1.6)), 'last touch yesterday');
  assert.equal(lastTouch(daysAgoIso(3)), 'last touch 3 days ago');
  assert.equal(lastTouch(daysAgoIso(21)), 'last touch 3 weeks ago');
  assert.equal(lastTouch(daysAgoIso(90)), 'last touch 3 months ago');
});
