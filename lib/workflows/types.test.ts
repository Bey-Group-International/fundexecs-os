import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAdvance,
  levelToMinXp,
  STEP_TRANSITIONS,
  WORKFLOW_MIN_LEVEL,
  WORKFLOW_STEP_STATUSES,
  type WorkflowStepStatus
} from './types';

/* ----------------------------------------------------------------------------
 * Earn-workflow state machine + XP-gate suite.
 *
 * Pure policy — no DB, no IO. Mirrors the idiom of lib/credits/costs.test.ts.
 * --------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// XP gate
// ---------------------------------------------------------------------------

test('WORKFLOW_MIN_LEVEL is exactly 3', () => {
  assert.equal(WORKFLOW_MIN_LEVEL, 3);
});

test('levelToMinXp returns (level-1)^2 * 100', () => {
  assert.equal(levelToMinXp(1), 0);
  assert.equal(levelToMinXp(2), 100);
  assert.equal(levelToMinXp(3), 400);
  assert.equal(levelToMinXp(4), 900);
  assert.equal(levelToMinXp(7), 3600);
});

test('L3 threshold is 400 XP — matches xpToLevel curve', () => {
  // xpToLevel(xp) = floor(sqrt(xp/100)) + 1
  // Level 3 starts at floor(sqrt(400/100))+1 = floor(2)+1 = 3 ✓
  const minXp = levelToMinXp(WORKFLOW_MIN_LEVEL);
  assert.equal(minXp, 400);
  // 399 XP => level 2 (below gate)
  const levelAt399 = Math.floor(Math.sqrt(399 / 100)) + 1;
  assert.equal(levelAt399, 2);
  // 400 XP => level 3 (meets gate)
  const levelAt400 = Math.floor(Math.sqrt(400 / 100)) + 1;
  assert.equal(levelAt400, 3);
});

// ---------------------------------------------------------------------------
// State machine — exhaustive transition coverage
// ---------------------------------------------------------------------------

test('every status in WORKFLOW_STEP_STATUSES is covered by STEP_TRANSITIONS', () => {
  for (const status of WORKFLOW_STEP_STATUSES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(STEP_TRANSITIONS, status),
      `STEP_TRANSITIONS missing key: ${status}`
    );
  }
});

test('pending → active is legal; all other moves from pending are not', () => {
  assert.ok(canAdvance('pending', 'active'));
  for (const to of WORKFLOW_STEP_STATUSES) {
    if (to === 'active') continue;
    assert.equal(canAdvance('pending', to), false, `pending → ${to} should be illegal`);
  }
});

test('active can move to awaiting_approval, done, skipped, or failed', () => {
  const legal: WorkflowStepStatus[] = ['awaiting_approval', 'done', 'skipped', 'failed'];
  for (const to of legal) {
    assert.ok(canAdvance('active', to), `active → ${to} should be legal`);
  }
  assert.equal(canAdvance('active', 'pending'), false);
  assert.equal(canAdvance('active', 'active'), false);
});

test('awaiting_approval can move to done, skipped, or failed only', () => {
  assert.ok(canAdvance('awaiting_approval', 'done'));
  assert.ok(canAdvance('awaiting_approval', 'skipped'));
  assert.ok(canAdvance('awaiting_approval', 'failed'));
  assert.equal(canAdvance('awaiting_approval', 'pending'), false);
  assert.equal(canAdvance('awaiting_approval', 'active'), false);
  assert.equal(canAdvance('awaiting_approval', 'awaiting_approval'), false);
});

test('done is terminal — no outbound transitions', () => {
  for (const to of WORKFLOW_STEP_STATUSES) {
    assert.equal(canAdvance('done', to), false, `done → ${to} should be illegal`);
  }
});

test('skipped is terminal — no outbound transitions', () => {
  for (const to of WORKFLOW_STEP_STATUSES) {
    assert.equal(canAdvance('skipped', to), false, `skipped → ${to} should be illegal`);
  }
});

test('failed → active is the retry path; all else illegal', () => {
  assert.ok(canAdvance('failed', 'active'));
  for (const to of WORKFLOW_STEP_STATUSES) {
    if (to === 'active') continue;
    assert.equal(canAdvance('failed', to), false, `failed → ${to} should be illegal`);
  }
});

test('canAdvance returns false for any same-status self-transition', () => {
  for (const status of WORKFLOW_STEP_STATUSES) {
    assert.equal(
      canAdvance(status, status),
      false,
      `self-transition ${status} → ${status} must be illegal`
    );
  }
});
