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
  WORKFLOW_BASELINE,
  compliancePosture,
  irAction,
  irSentiment,
  isComplianceResolvable,
  isIrCategory,
  isTaskStatus,
  nextTaskStatus,
  normalizeComplianceCategory
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
