import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayoffs } from './payoffs';

test('buildPayoffs shows the live match count on the mandate line', () => {
  const p = buildPayoffs({ memberType: 'investment_firm', matchCount: 12 });
  assert.equal(p.mandate, 'Matchable — 12 matches waiting');
  assert.equal(p.identity, 'Discoverable on the network');
  assert.equal(p.evidence, 'Diligence-ready — the proof holds up');
});

test('buildPayoffs singularises one match', () => {
  assert.equal(
    buildPayoffs({ memberType: 'startup', matchCount: 1 }).mandate,
    'Matchable — 1 match waiting'
  );
});

test('buildPayoffs degrades to a qualitative, member-type-aware line', () => {
  // No count, zero, and null all fall back to the counterparty noun.
  assert.equal(buildPayoffs({ memberType: 'service_provider' }).mandate, 'Matchable to clients');
  assert.equal(
    buildPayoffs({ memberType: 'startup', matchCount: 0 }).mandate,
    'Matchable to investors'
  );
  assert.equal(
    buildPayoffs({ memberType: 'investment_firm', matchCount: null }).mandate,
    'Matchable to LP & co-investor mandates'
  );
  assert.equal(
    buildPayoffs({ memberType: 'individual_investor' }).mandate,
    'Matchable to deals & syndicates'
  );
  assert.equal(buildPayoffs({ memberType: 'student' }).mandate, 'Matchable to mentors & firms');
});
