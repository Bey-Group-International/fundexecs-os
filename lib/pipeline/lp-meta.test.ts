import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLpMeta } from './lp-meta';

test('parseLpMeta returns all-null for missing or malformed criteria', () => {
  for (const input of [null, undefined, 'text', 42, ['a'], {}]) {
    const meta = parseLpMeta(input);
    assert.equal(meta.description, null);
    assert.equal(meta.fitRationale, null);
    assert.equal(meta.assignedSpecialist, null);
    assert.equal(meta.firstTouchNote, null);
    assert.equal(meta.fit, null);
    assert.equal(meta.warmth, null);
    assert.equal(meta.source, null);
    assert.equal(meta.lastTouch, null);
  }
});

test('parseLpMeta reads the camelCase keys adoptLp writes', () => {
  const meta = parseLpMeta({
    description: ' Endowment, long duration ',
    fitRationale: 'Thesis-aligned anchor.',
    assignedSpecialist: 'Capital Connector',
    firstTouchNote: 'Met at SuperReturn.',
    lastTouch: '2d ago'
  });
  assert.equal(meta.description, 'Endowment, long duration');
  assert.equal(meta.fitRationale, 'Thesis-aligned anchor.');
  assert.equal(meta.assignedSpecialist, 'Capital Connector');
  assert.equal(meta.firstTouchNote, 'Met at SuperReturn.');
  assert.equal(meta.lastTouch, '2d ago');
});

test('parseLpMeta accepts snake_case fallbacks', () => {
  const meta = parseLpMeta({
    fit_rationale: 'r',
    assigned_specialist: 's',
    first_touch_note: 'f',
    fit_score: 82,
    last_touch: 'today'
  });
  assert.equal(meta.fitRationale, 'r');
  assert.equal(meta.assignedSpecialist, 's');
  assert.equal(meta.firstTouchNote, 'f');
  assert.equal(meta.fit, 82);
  assert.equal(meta.lastTouch, 'today');
});

test('parseLpMeta never synthesizes a fit score', () => {
  assert.equal(parseLpMeta({ fitScore: 'high' }).fit, null);
  assert.equal(parseLpMeta({ fitScore: '' }).fit, null);
  assert.equal(parseLpMeta({}).fit, null);
});

test('parseLpMeta clamps and rounds real fit scores', () => {
  assert.equal(parseLpMeta({ fitScore: 88 }).fit, 88);
  assert.equal(parseLpMeta({ fitScore: '76.4' }).fit, 76);
  assert.equal(parseLpMeta({ fitScore: 140 }).fit, 100);
  assert.equal(parseLpMeta({ fitScore: -5 }).fit, 0);
});

test('parseLpMeta normalizes warmth casing for display', () => {
  assert.equal(parseLpMeta({ warmth: 'warm' }).warmth, 'Warm');
  assert.equal(parseLpMeta({ warmth: 'HOT' }).warmth, 'Hot');
  assert.equal(parseLpMeta({ warmth: '  ' }).warmth, null);
});

test('parseLpMeta maps machine source tokens to operator vocabulary', () => {
  assert.equal(parseLpMeta({ source: 'ai_lp_discovery' }).source, 'Sloane sourced');
  assert.equal(parseLpMeta({ source: 'Warm intro · Theodore' }).source, 'Warm intro · Theodore');
});
