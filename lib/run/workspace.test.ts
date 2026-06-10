import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_EARN_PROMPTS,
  dailyCompletion,
  deriveRunPanels,
  rankRunFocus,
  runHeadline,
  type RunWorkspaceInputs
} from './workspace';

const INPUTS: RunWorkspaceInputs = {
  diligence: { amount: 3_000_000, count: 2, staleCount: 0, tone: 'azure' },
  dailyDone: 1,
  dailyTotal: 4
};

test('derives the four Run panels in rail order', () => {
  const panels = deriveRunPanels(INPUTS);
  assert.deepEqual(
    panels.map((p) => p.key),
    ['diligence', 'stress-test', 'action-plan', 'aggregation']
  );
  // The AI-first actions carry the canonical Earn prompts and no metric.
  assert.equal(panels[1].earnPrompt, RUN_EARN_PROMPTS.stressTest);
  assert.equal(panels[1].metric, null);
  assert.equal(panels[3].earnPrompt, RUN_EARN_PROMPTS.aggregation);
  // The action plan reads as today's completion (1/4 → 25).
  assert.deepEqual(panels[2].metric, { kind: 'score', label: "Today's actions", value: 25 });
});

test('dailyCompletion clamps and degrades to 0 without a queue', () => {
  assert.equal(dailyCompletion(0, 0), 0);
  assert.equal(dailyCompletion(3, 4), 75);
  assert.equal(dailyCompletion(9, 4), 100);
  assert.equal(dailyCompletion(-1, 4), 0);
  assert.equal(dailyCompletion(Number.NaN, 4), 0);
});

test('headline is the capital awaiting a decision', () => {
  const headline = runHeadline(INPUTS);
  assert.equal(headline.label, 'Awaiting a decision');
  assert.deepEqual(headline.metric, {
    kind: 'money',
    label: 'In diligence',
    amount: 3_000_000,
    count: 2
  });
});

test('focus prefers stale diligence, then the unfinished daily plan', () => {
  const panels = deriveRunPanels(INPUTS);
  assert.equal(rankRunFocus(panels, INPUTS), 'action-plan');

  const stale: RunWorkspaceInputs = {
    ...INPUTS,
    diligence: { amount: 1, count: 1, staleCount: 1, tone: 'warning' }
  };
  assert.equal(rankRunFocus(deriveRunPanels(stale), stale), 'diligence');

  const done: RunWorkspaceInputs = { ...INPUTS, dailyDone: 4 };
  assert.equal(rankRunFocus(deriveRunPanels(done), done), null);
});
