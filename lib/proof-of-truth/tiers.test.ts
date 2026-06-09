import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getQuestionSet, type ProfileQuestion } from './questions';
import {
  buildLadder,
  compareGaps,
  impactWeight,
  scoreDepth,
  tierForQuestion,
  WEAK_TEXT_LEN,
  type LadderItem
} from './tiers';

function q(memberType: 'investment_firm', id: string): ProfileQuestion {
  const found = getQuestionSet(memberType).find((x) => x.id === id);
  assert.ok(found, `question ${id} exists`);
  return found;
}

test('tierForQuestion routes identity, mandate, and evidence fields', () => {
  assert.equal(tierForQuestion(q('investment_firm', 'display_name')), 'identity');
  assert.equal(tierForQuestion(q('investment_firm', 'bio')), 'identity'); // prose but identity
  assert.equal(tierForQuestion(q('investment_firm', 'linkedin')), 'identity');
  assert.equal(tierForQuestion(q('investment_firm', 'firm_type')), 'mandate'); // structured
  assert.equal(tierForQuestion(q('investment_firm', 'sectors')), 'mandate'); // tags
  assert.equal(tierForQuestion(q('investment_firm', 'objective')), 'mandate'); // intent prose
  assert.equal(tierForQuestion(q('investment_firm', 'thesis')), 'evidence'); // deep prose
});

test('scoreDepth weighs prose by length and specificity', () => {
  const prose = { kind: 'textarea' as const };
  // Long enough AND specific (two sentences) → strong.
  assert.deepEqual(
    scoreDepth(prose, { text: 'We back seed founders. Why now matters most.', tagCount: 0 }),
    {
      present: true,
      weak: false
    }
  );
  // Long enough AND specific (carries a number) → strong even as one sentence.
  assert.deepEqual(
    scoreDepth(prose, { text: 'We lead $1M pre-seed rounds in vertical AI tooling', tagCount: 0 }),
    { present: true, weak: false }
  );
  // Past the length floor but a single vague sentence, no number → thin.
  assert.equal(scoreDepth(prose, { text: 'x'.repeat(WEAK_TEXT_LEN), tagCount: 0 }).weak, true);
  // Too short → thin.
  assert.equal(scoreDepth(prose, { text: 'too short', tagCount: 0 }).weak, true);
  // Absent → present false, not weak.
  assert.deepEqual(scoreDepth(prose, { text: '', tagCount: 0 }), { present: false, weak: false });
});

test('scoreDepth requires a figure for numeric fields', () => {
  const num = { kind: 'text' as const, expects: 'number' as const };
  assert.deepEqual(scoreDepth(num, { text: '$250K–$2M', tagCount: 0 }), {
    present: true,
    weak: false
  });
  assert.deepEqual(scoreDepth(num, { text: 'varies', tagCount: 0 }), { present: true, weak: true });
});

test('scoreDepth flags a lone tag as thin; plain text is never weak', () => {
  const tags = { kind: 'tags' as const };
  assert.deepEqual(scoreDepth(tags, { text: '', tagCount: 0 }), { present: false, weak: false });
  assert.deepEqual(scoreDepth(tags, { text: '', tagCount: 1 }), { present: true, weak: true });
  assert.deepEqual(scoreDepth(tags, { text: '', tagCount: 2 }), { present: true, weak: false });
  // Short structured text (a name, a headline) is present-or-not, never thin.
  assert.deepEqual(scoreDepth({ kind: 'text' as const }, { text: 'NW', tagCount: 0 }), {
    present: true,
    weak: false
  });
});

test('impactWeight falls back to rung default, honouring overrides', () => {
  assert.equal(impactWeight(q('investment_firm', 'display_name')), 1); // identity default
  assert.equal(impactWeight(q('investment_firm', 'firm_type')), 2); // mandate default
  assert.equal(impactWeight(q('investment_firm', 'thesis')), 3); // evidence default
  assert.equal(impactWeight(q('investment_firm', 'headline')), 2); // override above identity
  assert.equal(impactWeight(q('investment_firm', 'objective')), 3); // override above mandate
});

test('compareGaps orders by rung, then impact, then severity', () => {
  const mk = (tierOrder: number, impact: number, missing: boolean) => ({ tierOrder, impact, missing });
  // Lower rung first, regardless of impact.
  assert.ok(compareGaps(mk(1, 1, false), mk(2, 3, true)) < 0);
  // Same rung: higher impact first.
  assert.ok(compareGaps(mk(2, 3, false), mk(2, 1, true)) < 0);
  // Same rung and impact: missing before thin.
  assert.ok(compareGaps(mk(2, 2, true), mk(2, 2, false)) < 0);
  assert.equal(compareGaps(mk(2, 2, false), mk(2, 2, false)), 0);
});

test('buildLadder gates rungs and computes readiness in order', () => {
  // Identity fully strong, mandate partial, evidence empty.
  const items: LadderItem[] = [
    { tier: 'identity', optional: false, present: true, weak: false },
    { tier: 'identity', optional: false, present: true, weak: false },
    { tier: 'identity', optional: true, present: false, weak: false }, // optional, ignored
    { tier: 'mandate', optional: false, present: true, weak: false },
    { tier: 'mandate', optional: false, present: false, weak: false }, // gap
    { tier: 'evidence', optional: false, present: false, weak: false } // gap
  ];
  const ladder = buildLadder(items);

  const identity = ladder.tiers.find((t) => t.tier.id === 'identity')!;
  const mandate = ladder.tiers.find((t) => t.tier.id === 'mandate')!;
  const evidence = ladder.tiers.find((t) => t.tier.id === 'evidence')!;

  assert.equal(identity.complete, true);
  assert.equal(identity.locked, false);
  assert.equal(mandate.complete, false);
  assert.equal(mandate.locked, false); // identity complete → mandate is lit
  assert.equal(mandate.gaps, 1);
  assert.equal(evidence.locked, true); // mandate incomplete → evidence stays dim

  // Achieved readiness is the highest complete rung: identity → "Discoverable".
  assert.equal(ladder.readinessTierId, 'identity');
  assert.equal(ladder.readinessLabel, 'Discoverable');
  assert.equal(ladder.currentTierId, 'mandate'); // first incomplete rung
  assert.equal(ladder.institutionalReady, false);
});

test('buildLadder reaches institutional readiness only when all required are strong', () => {
  const strong: LadderItem[] = [
    { tier: 'identity', optional: false, present: true, weak: false },
    { tier: 'mandate', optional: false, present: true, weak: false },
    { tier: 'evidence', optional: false, present: true, weak: false }
  ];
  const ready = buildLadder(strong);
  assert.equal(ready.institutionalReady, true);
  assert.equal(ready.overallPct, 100);
  assert.equal(ready.readinessTierId, 'institutional');
  assert.equal(ready.readinessLabel, 'Institutionally ready');
  assert.equal(ready.currentTierId, 'institutional');

  // A single thin evidence field blocks the capstone (weak = 0.5 points).
  const thin: LadderItem[] = [
    { tier: 'identity', optional: false, present: true, weak: false },
    { tier: 'mandate', optional: false, present: true, weak: false },
    { tier: 'evidence', optional: false, present: true, weak: true }
  ];
  const notReady = buildLadder(thin);
  assert.equal(notReady.institutionalReady, false);
  assert.ok(notReady.overallPct < 100);
  const evidence = notReady.tiers.find((t) => t.tier.id === 'evidence')!;
  assert.equal(evidence.complete, false);
  assert.equal(evidence.gaps, 1);
});

test('buildLadder is empty-safe', () => {
  const ladder = buildLadder([]);
  assert.equal(ladder.overallPct, 0);
  assert.equal(ladder.institutionalReady, false);
  assert.equal(ladder.readinessTierId, null);
  assert.equal(ladder.readinessLabel, 'Getting started');
});
