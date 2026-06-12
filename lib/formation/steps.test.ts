import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATION_D0,
  FORMATION_ITEMS,
  fileSteps,
  type FormationData,
  type FormationKind
} from './config';
import {
  FORMATION_MATERIAL_KIND,
  FORMATION_MATERIAL_TITLE,
  STEP_FIELDS,
  applyFiledSpecs,
  formationStepSpec,
  missingPrereqs,
  orderingError,
  personalizeFormationData,
  stepTouched
} from './steps';

const KINDS = FORMATION_ITEMS.map((i) => i.kind);

test('STEP_FIELDS partitions every FormationData field exactly once', () => {
  const seen = new Map<string, FormationKind>();
  for (const kind of KINDS) {
    for (const field of STEP_FIELDS[kind]) {
      assert.ok(!seen.has(field), `${field} owned by both ${seen.get(field)} and ${kind}`);
      seen.set(field, kind);
    }
  }
  assert.equal(seen.size, Object.keys(FORMATION_D0).length);
});

test('formationStepSpec slices only the step’s own fields and copies arrays', () => {
  const spec = formationStepSpec('terms', FORMATION_D0);
  assert.deepEqual(Object.keys(spec).sort(), [...STEP_FIELDS.terms].sort());
  assert.equal(spec.fee, 2);

  const story = formationStepSpec('story', { ...FORMATION_D0, storyEdges: ['Strong network'] });
  assert.deepEqual(story.storyEdges, ['Strong network']);
  assert.notEqual(story.storyEdges, FORMATION_D0.storyEdges);
});

test('stepTouched is false on the baseline and true once a field changes', () => {
  for (const kind of KINDS) {
    assert.equal(stepTouched(kind, FORMATION_D0, FORMATION_D0), false, `${kind} touched at rest`);
  }
  assert.equal(stepTouched('story', { ...FORMATION_D0, storyHook: 'A fund.' }, FORMATION_D0), true);
  assert.equal(
    stepTouched('story', { ...FORMATION_D0, storyEdges: ['Operator experience'] }, FORMATION_D0),
    true
  );
  assert.equal(stepTouched('terms', { ...FORMATION_D0, fee: 1.5 }, FORMATION_D0), true);
  // A change in another step's field never marks this step.
  assert.equal(stepTouched('bank', { ...FORMATION_D0, fee: 1.5 }, FORMATION_D0), false);
});

test('stepTouched respects a personalized baseline', () => {
  const baseline = personalizeFormationData(FORMATION_D0, 'Acme Capital');
  assert.equal(stepTouched('structure', baseline, baseline), false);
  assert.equal(stepTouched('structure', FORMATION_D0, baseline), true);
});

test('missingPrereqs returns every unfiled earlier step, in order', () => {
  const none = new Set<FormationKind>();
  assert.equal(missingPrereqs('story', none).length, 0);
  assert.deepEqual(
    missingPrereqs('terms', none).map((i) => i.kind),
    ['story', 'structure']
  );
  assert.deepEqual(
    missingPrereqs('terms', new Set<FormationKind>(['story'])).map((i) => i.kind),
    ['structure']
  );
  assert.equal(missingPrereqs('bank', new Set<FormationKind>(KINDS.slice(0, 6))).length, 0);
});

test('orderingError names the missing steps, and clears when satisfied', () => {
  const err = orderingError('terms', new Set<FormationKind>());
  assert.ok(err && err.includes('Your fund story') && err.includes('Fund entity'));
  assert.equal(orderingError('story', new Set<FormationKind>()), null);
  assert.equal(orderingError('terms', new Set<FormationKind>(['story', 'structure'])), null);
});

test('every step except bank maps to a data-room kind + title', () => {
  for (const kind of KINDS) {
    if (kind === 'bank') {
      assert.equal(FORMATION_MATERIAL_KIND[kind], undefined);
      continue;
    }
    assert.ok(FORMATION_MATERIAL_KIND[kind], `${kind} has no material kind`);
    assert.ok(FORMATION_MATERIAL_TITLE[kind], `${kind} has no material title`);
  }
  const dbKinds = Object.values(FORMATION_MATERIAL_KIND);
  assert.equal(new Set(dbKinds).size, dbKinds.length);
});

test('personalizeFormationData fills firm names only when untouched', () => {
  const fresh = personalizeFormationData(FORMATION_D0, 'Acme Capital');
  assert.equal(fresh.gp, 'Acme Capital GP, LLC');
  assert.equal(fresh.mgmtco, 'Acme Capital Management, LLC');

  const edited: FormationData = { ...FORMATION_D0, gp: 'Bespoke GP LLC' };
  const kept = personalizeFormationData(edited, 'Acme Capital');
  assert.equal(kept.gp, 'Bespoke GP LLC');
  assert.equal(kept.mgmtco, 'Acme Capital Management, LLC');
});

test('personalizeFormationData leaves defaults alone for blank firm names', () => {
  for (const firm of ['', '   ']) {
    const out = personalizeFormationData(FORMATION_D0, firm);
    assert.equal(out.gp, 'GP, LLC');
    assert.equal(out.mgmtco, 'Management, LLC');
  }
  const trimmed = personalizeFormationData(FORMATION_D0, '  Acme Capital  ');
  assert.equal(trimmed.gp, 'Acme Capital GP, LLC');
});

test('fileSteps shows the data-room line exactly for steps that file a document', () => {
  for (const item of FORMATION_ITEMS) {
    const steps = fileSteps(item.kind, FORMATION_D0);
    assert.equal(
      steps.includes('Filing to your data room'),
      Boolean(FORMATION_MATERIAL_KIND[item.kind]),
      `${item.kind} data-room line out of sync with FORMATION_MATERIAL_KIND`
    );
  }
});

test('applyFiledSpecs overlays filed slices and ignores junk', () => {
  const working: FormationData = { ...FORMATION_D0, fee: 1.5, storyHook: 'Unfiled edit' };
  const out = applyFiledSpecs(working, {
    lpa: { fee: 2.5, carry: 25 },
    story: { storyHook: 'Filed hook', storyEdges: ['Strong network', 42] },
    unknown: { fee: 99 }
  });
  // Filed slices win over working edits…
  assert.equal(out.fee, 2.5);
  assert.equal(out.carry, 25);
  assert.equal(out.storyHook, 'Filed hook');
  // …array values keep only well-typed entries, junk ids change nothing…
  assert.deepEqual(out.storyEdges, ['Strong network']);
  // …and steps without a snapshot keep the working values.
  assert.equal(out.hurdle, working.hurdle);
});

test('applyFiledSpecs never lets a mistyped spec value displace a typed field', () => {
  const out = applyFiledSpecs(FORMATION_D0, {
    lpa: { fee: 'two percent', termsUndecided: 'yes' },
    regd: { erisa: true }
  });
  assert.equal(out.fee, FORMATION_D0.fee);
  assert.equal(out.termsUndecided, FORMATION_D0.termsUndecided);
  assert.equal(out.erisa, true);
});
