import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATION_D0, FORMATION_ITEMS, type FormationData } from './config';
import { FORMATION_DOC_DISCLAIMER, composeFormationDoc, renderFormationDoc } from './compose';

const CTX = { firm: 'Acme Capital' };
const KINDS = FORMATION_ITEMS.map((i) => i.kind);

test('every kind composes a titled doc with substantive sections + disclaimer', () => {
  for (const kind of KINDS) {
    const doc = composeFormationDoc(kind, FORMATION_D0, CTX);
    assert.equal(doc.kind, kind);
    assert.ok(doc.title.length > 0 && doc.lede.length > 0);
    assert.ok(doc.sections.length >= 2, `${kind} has too few sections`);
    for (const s of doc.sections) {
      assert.ok(s.heading.length > 0);
      assert.ok(s.paras.length + s.rows.length > 0, `${kind} · ${s.heading} is empty`);
    }
    assert.equal(doc.disclaimer, FORMATION_DOC_DISCLAIMER);
    assert.match(doc.disclaimer, /Illustrative/);
  }
});

test('the LPA carries the decided economics into its rows and waterfall', () => {
  const d: FormationData = { ...FORMATION_D0, fee: 1.5, carry: 25, hurdle: 6 };
  const doc = composeFormationDoc('terms', d, CTX);
  const econ = doc.sections.find((s) => s.heading === 'Economic terms');
  assert.ok(econ?.rows.some(([, v]) => v.startsWith('1.5%')));
  assert.ok(econ?.rows.some(([, v]) => v.startsWith('25%')));
  const waterfall = doc.sections.find((s) => s.heading === 'Distribution waterfall');
  assert.match(waterfall?.paras[0] ?? '', /6% preferred/);
  assert.match(waterfall?.paras[0] ?? '', /75\/25/);
});

test('terms undecided is surfaced, never hidden', () => {
  const doc = composeFormationDoc('terms', { ...FORMATION_D0, termsUndecided: true }, CTX);
  const econ = doc.sections.find((s) => s.heading === 'Economic terms');
  assert.ok(econ?.rows.some(([k, v]) => k === 'Basis' && v.includes('set by Earn')));
});

test('PPM contents reflect the include/omit toggles', () => {
  const d: FormationData = { ...FORMATION_D0, ppmTrack: false, ppmSector: false };
  const doc = composeFormationDoc('ppm', d, CTX);
  const contents = doc.sections.find((s) => s.heading === 'Contents');
  assert.deepEqual(
    contents?.rows.find(([k]) => k === 'Track record'),
    ['Track record', 'Omitted']
  );
  assert.deepEqual(
    contents?.rows.find(([k]) => k === 'Conflicts of interest disclosure'),
    ['Conflicts of interest disclosure', 'Included']
  );
  const risks = doc.sections.find((s) => s.heading === 'Risk factors');
  assert.match(risks?.paras[0] ?? '', /omitted at your direction/);
});

test('undecided entity and exemption resolve to the Earn standard, annotated', () => {
  const d: FormationData = { ...FORMATION_D0, entity: 'Undecided', exemption: 'Undecided' };
  const cert = composeFormationDoc('structure', d, CTX);
  const entityRow = cert.sections[0].rows.find(([k]) => k === 'Fund entity');
  assert.equal(entityRow?.[1], 'Delaware LP (Earn standard)');

  const formD = composeFormationDoc('regulatory', d, CTX);
  const exemptionRow = formD.sections[0].rows.find(([k]) => k === 'Exemption');
  assert.equal(exemptionRow?.[1], 'Rule 506(b) (Earn standard)');
  assert.match(formD.sections[1].paras[1], /506\(b\)/);
});

test('the 506(c) path swaps the filing guidance', () => {
  const doc = composeFormationDoc('regulatory', { ...FORMATION_D0, exemption: '506(c)' }, CTX);
  assert.match(doc.sections[1].paras[1], /verified\s+accredited/);
});

test('an unwritten story says so instead of inventing copy', () => {
  const blank: FormationData = {
    ...FORMATION_D0,
    storyHook: '',
    storyOrigin: '',
    storyEdges: [],
    storyWhyNow: ''
  };
  const doc = composeFormationDoc('story', blank, CTX);
  const positioning = doc.sections.find((s) => s.heading === 'Positioning');
  assert.match(positioning?.paras[0] ?? '', /Not yet written/);
  const edge = doc.sections.find((s) => s.heading === 'Your edge');
  assert.match(edge?.paras[0] ?? '', /Not yet written/);
});

test('the firm name threads through the composed docs', () => {
  const doc = composeFormationDoc('structure', FORMATION_D0, CTX);
  assert.ok(doc.sections.some((s) => s.paras.some((p) => p.includes('Acme Capital'))));
});

test('renderFormationDoc emits every section, row and paragraph plus the disclaimer', () => {
  for (const kind of KINDS) {
    const doc = composeFormationDoc(kind, FORMATION_D0, CTX);
    const text = renderFormationDoc(doc);
    assert.ok(text.startsWith(`# ${doc.title}`));
    assert.ok(text.includes(doc.lede));
    for (const s of doc.sections) {
      assert.ok(text.includes(`## ${s.heading}`), `${kind} missing section ${s.heading}`);
      for (const [k, v] of s.rows) assert.ok(text.includes(`- ${k}: ${v}`));
      for (const p of s.paras) assert.ok(text.includes(p));
    }
    assert.ok(text.includes(FORMATION_DOC_DISCLAIMER));
  }
});

test('renderFormationDoc snapshots differ when the decisions differ', () => {
  const a = renderFormationDoc(composeFormationDoc('terms', FORMATION_D0, CTX));
  const b = renderFormationDoc(composeFormationDoc('terms', { ...FORMATION_D0, fee: 1.5 }, CTX));
  assert.notEqual(a, b);
  assert.ok(b.includes('1.5%'));
});
