import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOutcomeKind, OUTCOME_KINDS, OUTCOME_KIND_ORDER, type OutcomeKind } from './outcomes';
import { BRAINS } from '@/lib/ai/brains';

/* ----------------------------------------------------------------------------
 * Earn outcomes vocabulary regression suite.
 *
 * The ledger's filter chips, the approve-loop writer, and the
 * `earn_outcomes_kind_valid` DB check constraint all read the same kind
 * catalog. These locks keep them from drifting apart: the order list must
 * cover every kind exactly once, the guard must agree, and every kind's
 * specialist attribution must resolve to a real roster desk (otherwise the
 * ledger would render an orphaned attribution).
 * -------------------------------------------------------------------------- */

test('OUTCOME_KIND_ORDER covers every kind exactly once', () => {
  const keys = Object.keys(OUTCOME_KINDS) as OutcomeKind[];
  assert.equal(OUTCOME_KIND_ORDER.length, keys.length);
  assert.deepEqual([...OUTCOME_KIND_ORDER].sort(), [...keys].sort());
});

test('isOutcomeKind accepts known kinds and rejects others', () => {
  for (const k of OUTCOME_KIND_ORDER) assert.equal(isOutcomeKind(k), true);
  assert.equal(isOutcomeKind('not_a_kind'), false);
  assert.equal(isOutcomeKind(''), false);
});

test('every kind attributes to a real roster specialist', () => {
  const slugs = new Set(BRAINS.map((b) => b.slug));
  for (const k of OUTCOME_KIND_ORDER) {
    const meta = OUTCOME_KINDS[k];
    assert.ok(meta.label.length > 0, `${k} needs a label`);
    assert.ok(
      slugs.has(meta.specialistSlug),
      `${k} attributes to unknown slug "${meta.specialistSlug}"`
    );
  }
});
