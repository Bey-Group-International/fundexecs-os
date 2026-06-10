import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSourcePanels,
  rankSourceFocus,
  sourceHeadline,
  type SourceWorkspaceInputs
} from './workspace';

const stake = (
  amount: number,
  count = 1,
  staleCount = 0,
  tone: 'azure' | 'warning' | 'danger' = 'azure'
) => ({
  amount,
  count,
  staleCount,
  tone
});

const INPUTS: SourceWorkspaceInputs = {
  deals: stake(2_000_000, 3),
  raiseGap: stake(5_000_000, 0),
  raise: { target: 10_000_000, committed: 4_000_000, softCircled: 1_000_000, coveragePct: 50 }
};

test('derives the four Source panels in rail order with their metrics', () => {
  const panels = deriveSourcePanels(INPUTS);
  assert.deepEqual(
    panels.map((p) => p.key),
    ['deals', 'lps', 'capital', 'targets']
  );
  assert.deepEqual(panels[0].metric, {
    kind: 'money',
    label: 'Sourced & in motion',
    amount: 2_000_000,
    count: 3
  });
  assert.deepEqual(panels[1].metric, {
    kind: 'money',
    label: 'Still to raise',
    amount: 5_000_000,
    count: 0
  });
  // Capital reads as raise coverage (committed + soft vs target).
  assert.deepEqual(panels[2].metric, { kind: 'score', label: 'Raise coverage', value: 50 });
  assert.equal(panels[2].tone, 'azure');
  // Targets renders its calm "coming soon" state (null metric) until a scout runs.
  assert.equal(panels[3].metric, null);
  assert.equal(panels[3].tone, 'azure');
});

test('stale deal flow surfaces in the hint and carries the stake tone', () => {
  const panels = deriveSourcePanels({ ...INPUTS, deals: stake(1, 2, 2, 'warning') });
  assert.equal(panels[0].tone, 'warning');
  assert.match(panels[0].hint, /2 gone quiet/);
});

test('headline is capital in motion: sourced + soft-circled', () => {
  const headline = sourceHeadline(INPUTS);
  assert.equal(headline.metric.kind, 'money');
  assert.equal(headline.metric.kind === 'money' && headline.metric.amount, 3_000_000);
});

test('focus prefers stale stakes, then the LP gap, then nothing', () => {
  const panels = deriveSourcePanels(INPUTS);
  // No staleness → the standing job: close the raise gap.
  assert.equal(rankSourceFocus(panels, INPUTS), 'lps');

  const staleInputs = { ...INPUTS, deals: stake(1, 1, 1, 'danger') };
  assert.equal(rankSourceFocus(deriveSourcePanels(staleInputs), staleInputs), 'deals');

  const doneInputs = { ...INPUTS, raiseGap: stake(0, 0) };
  assert.equal(rankSourceFocus(deriveSourcePanels(doneInputs), doneInputs), null);
});
