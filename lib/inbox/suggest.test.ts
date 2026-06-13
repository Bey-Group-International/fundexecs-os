import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestDeal, tokenize } from './suggest';
import type { InboxDealOption, InboxItem } from './channels';

/* ----------------------------------------------------------------------------
 * Deal routing suggestion (pure).
 *
 * Locks the honesty contract: a deal is only ever suggested on a real lexical
 * match between its name and the conversation, never a guess.
 * --------------------------------------------------------------------------*/

const deals: InboxDealOption[] = [
  { id: 'd-atlas', name: 'Project Atlas Series B', stage: 'allocation', status: 'active' },
  { id: 'd-orion', name: 'Orion Credit Facility', stage: 'sourcing', status: 'active' },
  { id: 'd-zephyr', name: 'Zephyr Logistics', stage: 'sourcing', status: 'active' }
];

function item(over: Partial<InboxItem>): Pick<InboxItem, 'subject' | 'preview' | 'dealId'> {
  return { subject: '', preview: '', dealId: null, ...over };
}

test('tokenize drops stopwords and short/Re: noise', () => {
  assert.deepEqual(tokenize('Re: the Atlas fund call'), ['atlas']);
});

test('suggestDeal matches on a shared, meaningful token', () => {
  const s = suggestDeal(item({ subject: 'Re: Atlas data room access' }), deals);
  assert.equal(s?.dealId, 'd-atlas');
  assert.deepEqual(s?.matched, ['atlas']);
});

test('suggestDeal returns null with no real overlap', () => {
  // "fund"/"capital" are stopwords; nothing distinctive matches.
  assert.equal(suggestDeal(item({ subject: 'Quick capital question' }), deals), null);
});

test('suggestDeal returns null on an empty conversation', () => {
  assert.equal(suggestDeal(item({}), deals), null);
});

test('suggestDeal prefers an already-bound deal', () => {
  const s = suggestDeal(item({ dealId: 'd-orion', subject: 'Atlas update' }), deals);
  assert.equal(s?.dealId, 'd-orion');
});

test('suggestDeal picks the strongest overlap', () => {
  const s = suggestDeal(item({ subject: 'Orion credit terms', preview: 'logistics aside' }), deals);
  assert.equal(s?.dealId, 'd-orion');
});
