import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLIANCE_BASELINE,
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_SEVERITIES,
  IR_BASELINE,
  IR_CATS,
  TASK_MOVE,
  TASK_STATUSES,
  TASK_TONE,
  WF_AUTOMATIONS,
  WF_COLUMNS,
  WORKFLOW_BASELINE,
  automationStatusLabel,
  compliancePosture,
  irAction,
  irSentiment,
  isAutomationKey,
  isComplianceResolvable,
  isIrCategory,
  isTaskStatus,
  nextTaskStatus,
  normalizeComplianceCategory,
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

test('the compliance baseline is rich, honest, and never pre-resolved', () => {
  assert.ok(COMPLIANCE_BASELINE.length >= 8);
  for (const item of COMPLIANCE_BASELINE) {
    assert.ok(item.name.trim().length > 0);
    assert.ok((COMPLIANCE_SEVERITIES as readonly string[]).includes(item.severity));
    assert.ok((COMPLIANCE_CATEGORIES as readonly string[]).includes(item.category));
    // No fake filing is ever marked done — every seed starts workable.
    assert.ok(isComplianceResolvable(item.status));
    assert.ok(item.owner.trim().length > 0);
    assert.ok(item.due.trim().length > 0);
    assert.ok(item.drives.length > 10);
    assert.ok(item.action.trim().length > 0);
    assert.ok(item.detail.length > 20);
    assert.ok(item.checklist.length >= 2);
  }
  assert.ok(COMPLIANCE_BASELINE.some((i) => i.severity === 'high'));
  // All four board categories are represented.
  for (const cat of COMPLIANCE_CATEGORIES) {
    assert.ok(COMPLIANCE_BASELINE.some((i) => i.category === cat));
  }
});

test('only open and upcoming compliance items are resolvable', () => {
  assert.ok(isComplianceResolvable('open'));
  assert.ok(isComplianceResolvable('upcoming'));
  assert.equal(isComplianceResolvable('resolved'), false);
  assert.equal(isComplianceResolvable('done'), false);
});

test('the posture ladder ranks high-open over open over upcoming over clear', () => {
  assert.deepEqual(
    compliancePosture([
      { status: 'open', severity: 'high' },
      { status: 'open', severity: 'low' }
    ]),
    { label: 'Action required', tone: 'danger' }
  );
  assert.deepEqual(
    compliancePosture([
      { status: 'open', severity: 'low' },
      { status: 'upcoming', severity: 'medium' }
    ]),
    { label: 'Items open', tone: 'warning' }
  );
  assert.deepEqual(
    compliancePosture([
      { status: 'upcoming', severity: 'high' },
      { status: 'resolved', severity: 'high' }
    ]),
    { label: 'On track', tone: 'info' }
  );
  assert.deepEqual(compliancePosture([{ status: 'resolved', severity: 'high' }]), {
    label: 'Fully compliant',
    tone: 'success'
  });
  assert.deepEqual(compliancePosture([]), { label: 'Fully compliant', tone: 'success' });
});

test('legacy category labels bucket into the four board categories', () => {
  // Canonical values pass through, case-insensitively.
  assert.equal(normalizeComplianceCategory('Regulatory'), 'Regulatory');
  assert.equal(normalizeComplianceCategory('data & cyber'), 'Data & Cyber');
  // The original five-item baseline's obligation-as-category rows.
  assert.equal(normalizeComplianceCategory('Reg D / Form D'), 'Regulatory');
  assert.equal(normalizeComplianceCategory('Accreditation records'), 'Investor');
  assert.equal(normalizeComplianceCategory('Advertising & solicitation'), 'Internal');
  assert.equal(normalizeComplianceCategory('Books & records'), 'Internal');
  assert.equal(normalizeComplianceCategory('Privacy & data handling'), 'Data & Cyber');
  // Unknowns land in Internal rather than throwing.
  assert.equal(normalizeComplianceCategory('Something else'), 'Internal');
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
