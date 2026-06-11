import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD_PANEL_KEYS,
  buildRecordStrength,
  deriveBuildPanels,
  panelTone,
  rankBuildFocus,
  type BuildPanelInputs
} from './workspace';

const INPUTS: BuildPanelInputs = {
  profileCompleteness: 80,
  profileGaps: ['Track record', 'Target raise'],
  loopProgress: 35,
  readinessScore: 55,
  lockedByReadiness: 1_000_000,
  executionScore: 20
};

/* ── deriveBuildPanels ─────────────────────────────────────────────────── */

test('derives all four panels in rail order with their scores', () => {
  const panels = deriveBuildPanels(INPUTS);
  assert.deepEqual(
    panels.map((p) => p.key),
    [...BUILD_PANEL_KEYS]
  );
  assert.deepEqual(
    panels.map((p) => p.score),
    [80, 35, 55, 20]
  );
  // Every panel deep-links to its live subsection route.
  for (const p of panels) assert.ok(p.href.startsWith('/'));
});

test('clamps malformed scores to the 0–100 integer range', () => {
  const panels = deriveBuildPanels({
    ...INPUTS,
    profileCompleteness: 140,
    loopProgress: -5,
    readinessScore: Number.NaN,
    executionScore: 59.6
  });
  assert.deepEqual(
    panels.map((p) => p.score),
    [100, 0, 0, 60]
  );
});

test('profile gaps are carried (capped at 3); other panels carry none', () => {
  const panels = deriveBuildPanels({
    ...INPUTS,
    profileGaps: ['a', 'b', 'c', 'd']
  });
  assert.deepEqual(panels[0].gaps, ['a', 'b', 'c']);
  for (const p of panels.slice(1)) assert.deepEqual(p.gaps, []);
});

/* ── panelTone ─────────────────────────────────────────────────────────── */

test('tones match the rail badge thresholds', () => {
  assert.equal(panelTone(70), 'success');
  assert.equal(panelTone(69), 'azure');
  assert.equal(panelTone(40), 'azure');
  assert.equal(panelTone(39), 'warning');
});

/* ── buildRecordStrength / rankBuildFocus ──────────────────────────────── */

test('record strength is the rounded mean of panel scores', () => {
  const panels = deriveBuildPanels(INPUTS);
  // (80 + 35 + 55 + 20) / 4 = 47.5 → 48
  assert.equal(buildRecordStrength(panels), 48);
  assert.equal(buildRecordStrength([]), 0);
});

test('focus is the weakest panel, ties broken by rail order', () => {
  const panels = deriveBuildPanels(INPUTS);
  assert.equal(rankBuildFocus(panels)?.key, 'trust');

  const tied = deriveBuildPanels({
    ...INPUTS,
    profileCompleteness: 20,
    executionScore: 20
  });
  // profile (upstream) wins the tie at 20.
  assert.equal(rankBuildFocus(tied)?.key, 'profile');
  assert.equal(rankBuildFocus([]), null);
});
