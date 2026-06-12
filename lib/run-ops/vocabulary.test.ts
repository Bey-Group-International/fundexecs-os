import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLIANCE_BASELINE,
  COMPLIANCE_SEVERITIES,
  IR_BASELINE,
  TASK_MOVE,
  TASK_STATUSES,
  TASK_TONE,
  WF_AUTOMATIONS,
  WF_COLUMNS,
  WORKFLOW_BASELINE,
  automationStatusLabel,
  isAutomationKey,
  isTaskStatus,
  nextTaskStatus,
  streamIconKey,
  taskRunDraft,
  taskRunSteps,
  workflowPosture
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
    for (const task of wf.tasks) {
      assert.ok(task.name.trim().length > 0);
      assert.ok(task.who.trim().length > 0);
      assert.ok(task.drives.trim().length > 0);
      assert.ok(task.action.trim().length > 0);
      assert.ok(task.sub.length >= 2);
    }
  }
  // Every stream carries at least one critical-path step for the posture CTA.
  for (const wf of WORKFLOW_BASELINE) assert.ok(wf.tasks.some((t) => t.critical));
});

test('the board columns and tones cover every status in order', () => {
  assert.deepEqual(
    WF_COLUMNS.map((c) => c.status),
    [...TASK_STATUSES]
  );
  assert.equal(TASK_TONE.todo, 'warning');
  assert.equal(TASK_TONE.doing, 'azure');
  assert.equal(TASK_TONE.done, 'success');
});

test('workflowPosture counts done, open and blocking critical steps', () => {
  const tasks = [
    { status: 'done', critical: true },
    { status: 'doing', critical: true },
    { status: 'todo', critical: false },
    { status: 'todo', critical: true }
  ];
  const p = workflowPosture(tasks);
  assert.deepEqual(p, { total: 4, done: 1, open: 3, critOpen: 2, pct: 25 });
  assert.deepEqual(workflowPosture([]), { total: 0, done: 0, open: 0, critOpen: 0, pct: 0 });
});

test('stream icons resolve by name with a list-checks fallback', () => {
  assert.equal(streamIconKey('Launch'), 'rocket');
  assert.equal(streamIconKey('Raise'), 'landmark');
  assert.equal(streamIconKey('Deploy'), 'briefcase');
  assert.equal(streamIconKey('LP onboarding'), 'user-plus');
  assert.equal(streamIconKey('Quarter-end reporting'), 'calendar-clock');
  assert.equal(streamIconKey('Something else'), 'list-checks');
});

test('the automations catalog has unique persistable keys', () => {
  assert.ok(WF_AUTOMATIONS.length >= 4);
  const keys = WF_AUTOMATIONS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.ok(isAutomationKey(key));
  assert.equal(isAutomationKey('made_up'), false);
});

test('automation status copy never invents run history', () => {
  assert.equal(automationStatusLabel(false, null), 'Paused');
  assert.equal(automationStatusLabel(true, null), 'On');
  const now = Date.parse('2026-06-12T12:00:00Z');
  assert.equal(automationStatusLabel(true, '2026-06-12T11:30:00Z', now), 'Ran just now');
  assert.equal(automationStatusLabel(true, '2026-06-12T04:00:00Z', now), 'Ran 8h ago');
  assert.equal(automationStatusLabel(true, '2026-06-10T04:00:00Z', now), 'Ran 2d ago');
});

test('the runItem choreography carries the owner and the why', () => {
  assert.deepEqual(taskRunSteps('Sloane', 'Draft the wave'), [
    'Pull context with Sloane',
    'Draft the wave',
    'Update the record',
    'Prepare for your approval'
  ]);
  assert.equal(taskRunSteps(null, 'Start')[0], "Pull the step's context");

  const draft = taskRunDraft({
    name: 'Send the first outreach wave',
    who: 'Sloane',
    drives: 'Starts the raise clock',
    act: 'Draft the wave',
    toLabel: 'In progress'
  });
  assert.ok(draft.includes('Sloane prepared "Draft the wave"'));
  assert.ok(draft.includes('This starts the raise clock.'));
  assert.ok(draft.includes('move it to In progress'));
  const bare = taskRunDraft({
    name: 'Task',
    who: null,
    drives: null,
    act: 'Start',
    toLabel: 'Done'
  });
  assert.ok(bare.includes('"Start" is prepared for Task.'));
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
