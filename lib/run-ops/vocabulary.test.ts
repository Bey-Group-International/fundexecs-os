import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLIANCE_BASELINE,
  COMPLIANCE_SEVERITIES,
  IR_BASELINE,
  TASK_MOVE,
  TASK_STATUSES,
  WORKFLOW_BASELINE,
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

test('the IR baseline has future-dated deliverables', () => {
  assert.ok(IR_BASELINE.length >= 3);
  for (const item of IR_BASELINE) {
    assert.ok(item.cat.trim().length > 0);
    assert.ok(item.dueInDays > 0);
  }
});
