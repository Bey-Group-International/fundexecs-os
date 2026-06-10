import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCommitment, commitmentTone, ANALYST_AGENTS, SYNTHESIS_AGENT } from './utils';

/* ----------------------------------------------------------------------------
 * Meeting Copilot utility suite.
 *
 * Pure-logic tests for the two utility functions that drive the HubPanel tone
 * and the orchestrator's score clamping. No DB, no Claude, no server-only
 * modules, no env vars needed — imports only from utils.ts.
 * --------------------------------------------------------------------------*/

test('clampCommitment clamps integers to 0–100', () => {
  assert.equal(clampCommitment(0), 0);
  assert.equal(clampCommitment(50), 50);
  assert.equal(clampCommitment(100), 100);
  assert.equal(clampCommitment(-10), 0, 'below 0 should clamp to 0');
  assert.equal(clampCommitment(150), 100, 'above 100 should clamp to 100');
});

test('clampCommitment rounds floats', () => {
  assert.equal(clampCommitment(74.9), 75);
  assert.equal(clampCommitment(0.4), 0);
  assert.equal(clampCommitment(99.5), 100);
});

test('clampCommitment coerces numeric strings', () => {
  assert.equal(clampCommitment('42'), 42);
  assert.equal(clampCommitment('0'), 0);
  assert.equal(clampCommitment('100'), 100);
});

test('clampCommitment returns null for non-numeric input', () => {
  // null/undefined must return null (not 0 — Number(null) === 0 in JS)
  assert.equal(clampCommitment(null), null, 'null must be treated as no-score, not 0');
  assert.equal(clampCommitment(undefined), null, 'undefined must be treated as no-score');
  assert.equal(clampCommitment('not a number'), null);
  assert.equal(clampCommitment(NaN), null);
  assert.equal(clampCommitment(Infinity), null);
  assert.equal(clampCommitment(-Infinity), null);
});

test('commitmentTone maps score bands to the right tone', () => {
  // danger band: < 30
  assert.equal(commitmentTone(0), 'danger');
  assert.equal(commitmentTone(1), 'danger');
  assert.equal(commitmentTone(29), 'danger');

  // azure band: 30–69
  assert.equal(commitmentTone(30), 'azure');
  assert.equal(commitmentTone(50), 'azure');
  assert.equal(commitmentTone(69), 'azure');

  // success band: >= 70
  assert.equal(commitmentTone(70), 'success');
  assert.equal(commitmentTone(85), 'success');
  assert.equal(commitmentTone(100), 'success');
});

test('commitmentTone danger threshold is 30 (exclusive)', () => {
  assert.equal(commitmentTone(29), 'danger');
  assert.equal(commitmentTone(30), 'azure');
});

test('commitmentTone success threshold is 70 (inclusive)', () => {
  assert.equal(commitmentTone(69), 'azure');
  assert.equal(commitmentTone(70), 'success');
});

test('ANALYST_AGENTS has exactly three unique entries', () => {
  assert.equal(ANALYST_AGENTS.length, 3);
  const set = new Set(ANALYST_AGENTS);
  assert.equal(set.size, 3, 'each analyst agent must be unique');
});

test('SYNTHESIS_AGENT is not in ANALYST_AGENTS', () => {
  assert.ok(
    !(ANALYST_AGENTS as readonly string[]).includes(SYNTHESIS_AGENT),
    'synthesis must be separate from the analyst lanes'
  );
});
