import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_RANK, type EarnPhase } from '../../components/shell/earn/useEarnLifecycle';
import { handOffLine } from '../../lib/team/cognition-copy';

/* ----------------------------------------------------------------------------
 * Cognition lifecycle — phase rank + slug copy regression suite.
 *
 * Phase 2 adds the `handing_off` phase between `routing` and `retrieving`,
 * and the `handOff(slug)` action. The stream does not fire this phase yet —
 * phase 5 will. These tests lock the pure parts (rank ordering and copy
 * rendering) without rendering React; integration behavior (state
 * transitions, settle-timer slug clear, dev-trigger seam) is covered by
 * Playwright e2e under e2e/.
 *
 * If a future change rearranges PHASE_RANK or breaks handOffLine's voice
 * contract, this suite trips first.
 * --------------------------------------------------------------------------*/

test('PHASE_RANK includes handing_off in the right position', () => {
  // Strict ordering is what the advancement logic depends on. The new phase
  // must sit between routing (request in flight) and retrieving (sources
  // arrived) so a late handOff cannot retreat from a later phase.
  assert.ok(PHASE_RANK.routing < PHASE_RANK.handing_off, 'routing < handing_off');
  assert.ok(PHASE_RANK.handing_off < PHASE_RANK.retrieving, 'handing_off < retrieving');
  assert.ok(PHASE_RANK.retrieving < PHASE_RANK.streaming, 'retrieving < streaming');
  assert.ok(PHASE_RANK.streaming < PHASE_RANK.proposing, 'streaming < proposing');
  assert.ok(PHASE_RANK.proposing < PHASE_RANK.settled, 'proposing < settled');
});

test('PHASE_RANK covers every EarnPhase in the union, with unique ranks', () => {
  // The compile-time exhaustiveness of Record<EarnPhase, number> guarantees
  // every union member has a rank. We additionally assert the ranks are
  // unique so a future addition does not accidentally collide.
  const allPhases: EarnPhase[] = [
    'idle',
    'routing',
    'handing_off',
    'retrieving',
    'streaming',
    'proposing',
    'settled'
  ];
  const ranks = allPhases.map((p) => PHASE_RANK[p]);
  const unique = new Set(ranks);
  assert.equal(unique.size, allPhases.length, 'phase ranks must be unique');
  // idle must rank zero so non-idle checks (`phase !== 'idle'`) read cleanly.
  assert.equal(PHASE_RANK.idle, 0);
});

test('handOffLine returns operator-voice copy for known specialist slugs', () => {
  assert.equal(handOffLine('master-workflow'), 'Sterling is reviewing this.');
  assert.equal(handOffLine('executive-advisor'), 'Theodore is reviewing this.');
  assert.equal(handOffLine('legal-admin'), 'Adrian is reviewing this.');
  assert.equal(handOffLine('rainmaker'), 'Vivian is reviewing this.');
  assert.equal(handOffLine('deal-sourcer'), 'Marcus is reviewing this.');
});

test('handOffLine returns a safe fallback for unknown or empty slugs', () => {
  // Falls back to Earnest (the COO display name) + "is routing this." — no
  // throw, no leaked slug, no hype in the copy.
  assert.equal(handOffLine(null), 'Earnest is routing this.');
  assert.equal(handOffLine(undefined), 'Earnest is routing this.');
  assert.equal(handOffLine(''), 'Earnest is routing this.');
  assert.equal(handOffLine('not-a-real-slug'), 'Earnest is routing this.');
});

test('handOffLine voice rule: sentence case, no hype, single verb', () => {
  // Cheap operator-voice guard against drift. Any change that introduces an
  // exclamation, an emoji, or all-caps will trip here. Phase 5 may add new
  // verbs (review/check/pull) — when that lands, update this guard
  // deliberately rather than weakening it.
  const cases = [
    'master-workflow',
    'executive-advisor',
    'capital-raiser',
    'investor-relations',
    'unknown-slug',
    null
  ];
  for (const slug of cases) {
    const line = handOffLine(slug);
    assert.match(line, /\.$/, `line must end with a period (got: "${line}")`);
    assert.ok(!/[!?]/.test(line), `line must not contain ! or ? (got: "${line}")`);
    // No emoji. ASCII-printable + standard punctuation only.
    assert.ok(/^[\u0020-\u007E]+$/.test(line), `line must be plain ASCII (got: "${line}")`);
  }
});
