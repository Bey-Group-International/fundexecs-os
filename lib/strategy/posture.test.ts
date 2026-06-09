import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInstitutionalPosture, type PostureInput } from './posture';

const base: PostureInput = {
  trust: { truth: 0, concept: 0, execution: 0, work: 0 },
  capitalReadiness: 0,
  objectives: []
};

/** Look up a single posture dimension by key, asserting it exists. */
function dim(result: ReturnType<typeof computeInstitutionalPosture>, key: string) {
  const d = result.dimensions.find((x) => x.key === key);
  assert.ok(d, `dimension ${key} present`);
  return d!;
}

test('compliance blends trust truth (0.6) + concept (0.4)', () => {
  const r = computeInstitutionalPosture({
    ...base,
    trust: { truth: 100, concept: 50, execution: 0, work: 0 }
  });
  // 0.6*100 + 0.4*50 = 80
  assert.equal(dim(r, 'compliance').score, 80);
});

test('execution blends trust execution (0.55) + work (0.45)', () => {
  const r = computeInstitutionalPosture({
    ...base,
    trust: { truth: 0, concept: 0, execution: 100, work: 0 }
  });
  assert.equal(dim(r, 'execution').score, 55);
});

test('capital pillar mirrors capital readiness', () => {
  const r = computeInstitutionalPosture({ ...base, capitalReadiness: 42 });
  assert.equal(dim(r, 'capital').score, 42);
});

test('governance is capital-weighted objective completion (High3/Med2/Low1)', () => {
  const r = computeInstitutionalPosture({
    ...base,
    objectives: [
      { priority: 'High', done: true }, // 3 earned
      { priority: 'Medium', done: false }, // 0 of 2
      { priority: 'Low', done: false } // 0 of 1
    ]
  });
  // earned 3 / total 6 = 50
  assert.equal(dim(r, 'governance').score, 50);
});

test('capital is null (unmeasured), not zero, when the dimension is absent', () => {
  const r = computeInstitutionalPosture({
    trust: { truth: 100, concept: 100, execution: 100, work: 100 },
    capitalReadiness: null,
    objectives: [{ priority: 'High', done: true }]
  });
  // Capital excluded; the other three pillars are all 100 → composite 100.
  assert.equal(dim(r, 'capital').score, null);
  assert.equal(r.composite, 100);
});

test('governance is null (not zero) when no objectives are authored', () => {
  const r = computeInstitutionalPosture(base);
  assert.equal(dim(r, 'governance').score, null);
});

test('composite renormalizes over measurable pillars, excluding null governance', () => {
  // No objectives → governance null. Other three each 100 → composite 100, not 75.
  const r = computeInstitutionalPosture({
    trust: { truth: 100, concept: 100, execution: 100, work: 100 },
    capitalReadiness: 100,
    objectives: []
  });
  assert.equal(r.composite, 100);
  assert.equal(r.band, 'institutional');
});

test('band thresholds: institutional ≥75, emerging ≥50, building below', () => {
  const inst = computeInstitutionalPosture({
    trust: { truth: 80, concept: 80, execution: 80, work: 80 },
    capitalReadiness: 80,
    objectives: [{ priority: 'High', done: true }]
  });
  assert.equal(inst.band, 'institutional');

  const building = computeInstitutionalPosture({
    trust: { truth: 10, concept: 10, execution: 10, work: 10 },
    capitalReadiness: 10,
    objectives: [{ priority: 'High', done: false }]
  });
  assert.equal(building.band, 'building');
});

test('all-empty input yields a measurable building composite (trust/capital default 0)', () => {
  const r = computeInstitutionalPosture(base);
  // compliance/execution/capital are 0 (measurable), governance null → composite 0.
  assert.equal(r.composite, 0);
  assert.equal(r.band, 'building');
});

test('compliance pillar uses the standing tier when it has objectives', () => {
  const r = computeInstitutionalPosture({
    ...base,
    // Trust proxy would be 0; the lane (3 of 4 done, none overdue) wins.
    compliance: { total: 4, done: 3, overdue: 0 }
  });
  // 3/4 = 75, no penalty.
  assert.equal(dim(r, 'compliance').score, 75);
});

test('an empty compliance lane falls back to the trust truth+concept proxy', () => {
  const r = computeInstitutionalPosture({
    ...base,
    trust: { truth: 100, concept: 50, execution: 0, work: 0 },
    compliance: { total: 0, done: 0, overdue: 0 }
  });
  // 0.6*100 + 0.4*50 = 80 (the proxy), not 0.
  assert.equal(dim(r, 'compliance').score, 80);
});

test('overdue compliance items dock the compliance pillar', () => {
  const r = computeInstitutionalPosture({
    ...base,
    compliance: { total: 4, done: 3, overdue: 2 }
  });
  // 75 base − 2*12 penalty = 51.
  assert.equal(dim(r, 'compliance').score, 51);
});
