import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLIANCE_BASELINE,
  COMPLIANCE_SEVERITIES,
  IR_BASELINE,
  IR_CATS,
  TASK_MOVE,
  TASK_STATUSES,
  WORKFLOW_BASELINE,
  irAction,
  irSentiment,
  isIrCategory,
  isTaskStatus,
  nextTaskStatus
} from './vocabulary';

test('task statuses advance strictly in order and terminate at done', () => {
  assert.equal(nextTaskStatus('todo'), 'doing');
  assert.equal(nextTaskStatus('doing'), 'done');
  assert.equal(nextTaskStatus('done'), null);
  for (const s of TASK_STATUSES) assert.ok(isTaskStatus(s));
  assert.equal(isTaskStatus('blocked'), false);
  assert.equal(TASK_MOVE.todo, 'Start');
  assert.equal(TASK_MOVE.doing, 'Complete');
});

test('the workflow baseline is non-trivial and well-formed', () => {
  assert.ok(WORKFLOW_BASELINE.length >= 3);
  for (const wf of WORKFLOW_BASELINE) {
    assert.ok(wf.stream.trim().length > 0);
    assert.ok(wf.name.trim().length > 0);
    assert.ok(wf.tasks.length >= 3);
  }
});

test('the compliance baseline covers severities with honest notes', () => {
  assert.ok(COMPLIANCE_BASELINE.length >= 4);
  for (const item of COMPLIANCE_BASELINE) {
    assert.ok((COMPLIANCE_SEVERITIES as readonly string[]).includes(item.severity));
    assert.ok(item.note.length > 20);
  }
  assert.ok(COMPLIANCE_BASELINE.some((i) => i.severity === 'high'));
});

test('the IR baseline has future-dated deliverables with full anatomy', () => {
  assert.ok(IR_BASELINE.length >= 3);
  for (const item of IR_BASELINE) {
    assert.ok(item.name.trim().length > 0);
    assert.ok(isIrCategory(item.category));
    assert.ok(item.who.trim().length > 0);
    assert.ok(item.drives.length > 10);
    assert.ok(item.detail.length > 40);
    assert.ok(item.contents.length >= 3);
    assert.ok(item.dueInDays > 0);
  }
});

test('IR categories drive the filter chips and per-item actions', () => {
  assert.deepEqual([...IR_CATS], ['Letters', 'Statements', 'Events', 'Portal']);
  for (const cat of IR_CATS) assert.ok(irAction(cat).trim().length > 0);
  assert.equal(irAction('Letters'), 'Review & send');
  assert.equal(irAction(null), 'Prepare & send');
  assert.equal(irAction('Not a category'), 'Prepare & send');
  assert.equal(isIrCategory('Letters'), true);
  assert.equal(isIrCategory('letters'), false);
});

test('LP sentiment derives only from a real warmth signal', () => {
  assert.deepEqual(irSentiment('Hot'), { label: 'Champion', tone: 'success' });
  assert.deepEqual(irSentiment('warm'), { label: 'Engaged', tone: 'azure' });
  assert.deepEqual(irSentiment('Cold'), { label: 'Needs attention', tone: 'warning' });
  assert.equal(irSentiment(null), null);
  assert.equal(irSentiment(undefined), null);
  assert.equal(irSentiment('   '), null);
  assert.equal(irSentiment('lukewarm-ish nonsense'), null);
});
