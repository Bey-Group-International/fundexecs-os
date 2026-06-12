import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_NEXT,
  LEAD_STAGES,
  isLeadStage,
  lastActivityLabel,
  leadRunSteps,
  nextLeadStage,
  sanitizeLeadCandidates,
  summarizeLeads
} from './engine';

test('lead stages advance strictly in order and terminate at meeting', () => {
  assert.equal(nextLeadStage('new'), 'qualified');
  assert.equal(nextLeadStage('qualified'), 'contacted');
  assert.equal(nextLeadStage('contacted'), 'meeting');
  assert.equal(nextLeadStage('meeting'), null);
  for (const s of LEAD_STAGES) assert.ok(isLeadStage(s.key));
  assert.equal(isLeadStage('won'), false);
});

test('every non-terminal stage has a next move with the runner choreography', () => {
  assert.deepEqual(LEAD_NEXT, {
    new: 'Qualify',
    qualified: 'Reach out',
    contacted: 'Book meeting'
  });
  for (const s of LEAD_STAGES) {
    if (s.key === 'meeting') continue;
    const act = LEAD_NEXT[s.key];
    assert.deepEqual(leadRunSteps(act), [
      'Pull intent + firmographics',
      `Draft the ${act.toLowerCase()}`,
      'Personalize to their segment',
      'Prepare for your approval'
    ]);
  }
});

test('summarizeLeads rolls up live count, est. value and meetings', () => {
  assert.deepEqual(summarizeLeads([]), { live: 0, pipelineValue: 0, meetings: 0 });
  const sum = summarizeLeads([
    { stage: 'meeting', estValue: 240_000 },
    { stage: 'qualified', estValue: 180_000 },
    { stage: 'new', estValue: null }
  ]);
  assert.deepEqual(sum, { live: 3, pipelineValue: 420_000, meetings: 1 });
});

test('lastActivityLabel renders — / Today / Nd ago', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.equal(lastActivityLabel(null, now), '—');
  assert.equal(lastActivityLabel('not a date', now), '—');
  assert.equal(lastActivityLabel('2026-06-12T08:00:00Z', now), 'Today');
  assert.equal(lastActivityLabel('2026-06-10T08:00:00Z', now), '2d ago');
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
