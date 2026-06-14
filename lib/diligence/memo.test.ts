import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMemo } from './memo';
import type { DiligenceRunDetail } from '@/lib/queries/diligence';

/* ----------------------------------------------------------------------------
 * composeMemo pure-logic suite. No DB / LLM — the composer only formats a
 * DiligenceRunDetail into a citable IC memo. Locks the invariants that matter:
 * real provenance (lane + specialist appear), conviction surfaced, and graceful
 * handling of an empty/partial run.
 * -------------------------------------------------------------------------- */

function run(overrides: Partial<DiligenceRunDetail> = {}): DiligenceRunDetail {
  return {
    id: 'run-1',
    status: 'complete',
    conviction: 72,
    summary: 'Proceed to IC',
    dealId: 'deal-1',
    dealName: 'Acme Industrial',
    createdAt: '2026-06-14T00:00:00.000Z',
    analysts: [
      {
        agent: 'market_size',
        personaLabel: 'Theodore',
        laneLabel: 'Market Size',
        score: 80,
        summary: 'Large, growing TAM.',
        detail: 'SOM is defensible.',
        citations: [],
        resolvedAt: null,
        resolution: null
      }
    ],
    synthesis: {
      personaLabel: 'Earn',
      conviction: 72,
      memo: 'On balance the thesis holds.',
      recommendation: 'Advance to IC with conditions.',
      followUpQuestions: ['Confirm customer concentration.']
    },
    ...overrides
  };
}

test('composeMemo titles from the deal name', () => {
  assert.equal(composeMemo(run()).title, 'Investment Memo — Acme Industrial');
});

test('composeMemo surfaces recommendation and conviction', () => {
  const body = composeMemo(run()).body;
  assert.match(body, /Advance to IC with conditions\./);
  assert.match(body, /\*\*Conviction:\*\* 72\/100/);
});

test('composeMemo cites real lane + specialist provenance', () => {
  const body = composeMemo(run()).body;
  assert.match(body, /Market Size/);
  assert.match(body, /Theodore/);
  assert.match(body, /Confirm customer concentration\./);
});

test('composeMemo degrades gracefully on a bare run', () => {
  const memo = composeMemo(
    run({ dealName: null, conviction: null, analysts: [], synthesis: null })
  );
  assert.equal(memo.title, 'Investment Memo — Diligence run');
  assert.match(memo.body, /No recommendation recorded\./);
  assert.match(memo.body, /Conviction:\*\* —/);
});
