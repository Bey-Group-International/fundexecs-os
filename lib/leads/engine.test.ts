import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_MOVE,
  LEAD_STAGES,
  isLeadStage,
  nextLeadStage,
  sanitizeLeadCandidates
} from './engine';

test('lead stages advance strictly in order and terminate at meeting', () => {
  assert.equal(nextLeadStage('new'), 'qualified');
  assert.equal(nextLeadStage('qualified'), 'contacted');
  assert.equal(nextLeadStage('contacted'), 'meeting');
  assert.equal(nextLeadStage('meeting'), null);
  for (const s of LEAD_STAGES) assert.ok(isLeadStage(s.key));
  assert.equal(isLeadStage('won'), false);
});

test('every non-terminal stage has a move with run steps', () => {
  for (const s of LEAD_STAGES) {
    if (s.key === 'meeting') continue;
    const move = LEAD_MOVE[s.key];
    assert.ok(move.label.length > 0);
    assert.ok(move.steps.length >= 3);
  }
});

test('sanitizeLeadCandidates bounds and types AI output', () => {
  const out = sanitizeLeadCandidates([
    { name: 'Summit Equipment Co.', segment: 'Industrial OEM', intent: 88.6, estValue: 240000 },
    { companyName: 'Cascade Logistics', intentScore: 150, signal: 'Visited pricing 5×' },
    { name: '   ' }, // blank → dropped
    'junk',
    { name: 'x'.repeat(500), estValue: -5 }
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].intent, 89);
  assert.equal(out[1].name, 'Cascade Logistics');
  assert.equal(out[1].intent, 100);
  assert.equal(out[1].signal, 'Visited pricing 5×');
  assert.equal(out[2].name.length, 300);
  assert.equal(out[2].estValue, null);
});

test('sanitizeLeadCandidates caps the batch and survives garbage', () => {
  assert.deepEqual(sanitizeLeadCandidates(null), []);
  const big = Array.from({ length: 20 }, (_, i) => ({ name: `Lead ${i}` }));
  assert.equal(sanitizeLeadCandidates(big).length, 8);
});
