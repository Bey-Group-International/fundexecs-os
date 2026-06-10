import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDrivePanels,
  driveHeadline,
  rankDriveFocus,
  type DriveWorkspaceInputs
} from './workspace';

const INPUTS: DriveWorkspaceInputs = {
  nearClose: { amount: 2_500_000, count: 2, staleCount: 0, tone: 'azure' },
  committed: { amount: 4_000_000, count: 3, staleCount: 0, tone: 'azure' },
  materialsScore: 80,
  committedPct: 40
};

test('derives the four Drive panels in rail order', () => {
  const panels = deriveDrivePanels(INPUTS);
  assert.deepEqual(
    panels.map((p) => p.key),
    ['materials', 'deal-desk', 'cap-table', 'execute']
  );
  assert.deepEqual(panels[0].metric, {
    kind: 'score',
    label: 'Materials readiness',
    value: 80
  });
  assert.deepEqual(panels[1].metric, {
    kind: 'money',
    label: 'Near close',
    amount: 2_500_000,
    count: 2
  });
  // Execute is unbuilt: no link, no metric — a calm "soon" affordance.
  assert.equal(panels[3].href, undefined);
  assert.equal(panels[3].metric, null);
});

test('cap table is display-only azure — realized capital is never at risk', () => {
  const panels = deriveDrivePanels({
    ...INPUTS,
    committed: { amount: 1, count: 1, staleCount: 1, tone: 'danger' }
  });
  assert.equal(panels[2].tone, 'azure');
});

test('headline is close progress: committed vs target', () => {
  const headline = driveHeadline(INPUTS);
  assert.equal(headline.label, 'Close progress');
  assert.deepEqual(headline.metric, {
    kind: 'score',
    label: 'Committed vs target',
    value: 40
  });
});

test('focus prefers a slipping near-close, then weak materials', () => {
  assert.equal(rankDriveFocus(deriveDrivePanels(INPUTS), INPUTS), null);

  const weak: DriveWorkspaceInputs = { ...INPUTS, materialsScore: 50 };
  assert.equal(rankDriveFocus(deriveDrivePanels(weak), weak), 'materials');

  const slipping: DriveWorkspaceInputs = {
    ...INPUTS,
    materialsScore: 50,
    nearClose: { amount: 1, count: 1, staleCount: 1, tone: 'danger' }
  };
  assert.equal(rankDriveFocus(deriveDrivePanels(slipping), slipping), 'deal-desk');
});
