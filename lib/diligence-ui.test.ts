import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVerdict, workstreamSeverity, workstreamStatus } from './diligence-ui';

test('workstreamStatus maps scores to the prototype bands', () => {
  assert.equal(workstreamStatus(85, false), 'clear');
  assert.equal(workstreamStatus(70, false), 'clear');
  assert.equal(workstreamStatus(69, false), 'caution');
  assert.equal(workstreamStatus(45, false), 'caution');
  assert.equal(workstreamStatus(44, false), 'flag');
  assert.equal(workstreamStatus(10, false), 'flag');
  assert.equal(workstreamStatus(null, false), 'pending');
});

test('an operator-resolved finding is always clear', () => {
  assert.equal(workstreamStatus(10, true), 'clear');
  assert.equal(workstreamStatus(null, true), 'clear');
});

test('workstreamSeverity grades how far the score falls', () => {
  assert.equal(workstreamSeverity(10), 'High');
  assert.equal(workstreamSeverity(29), 'High');
  assert.equal(workstreamSeverity(30), 'Medium');
  assert.equal(workstreamSeverity(44), 'Medium');
  assert.equal(workstreamSeverity(45), 'Low');
  assert.equal(workstreamSeverity(null), 'Low');
});

test('runVerdict walks the prototype ladder', () => {
  const clear = { status: 'clear', severity: 'Low' } as const;
  const caution = { status: 'caution', severity: 'Low' } as const;
  const flag = { status: 'flag', severity: 'Medium' } as const;
  const highFlag = { status: 'flag', severity: 'High' } as const;

  assert.deepEqual(runVerdict([clear, highFlag, flag]), {
    label: 'On hold',
    tone: 'danger',
    note: '1 high-severity item to resolve'
  });
  assert.deepEqual(runVerdict([clear, flag]), {
    label: 'Conditional pass',
    tone: 'warning',
    note: '1 open item before IC'
  });
  assert.deepEqual(runVerdict([clear, caution, caution]), {
    label: 'Pass with notes',
    tone: 'info',
    note: '2 cautions logged'
  });
  assert.deepEqual(runVerdict([clear, clear]), {
    label: 'Clear to proceed',
    tone: 'success',
    note: 'IC-ready'
  });
  assert.equal(runVerdict([]).label, 'Clear to proceed');
});
