import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalPriority,
  convictionPriority,
  rankNextActions,
  reconnectPriority,
  velocityPriority,
  type NextAction
} from './next-best-action';

/* ----------------------------------------------------------------------------
 * Next-Best-Action engine — pure-logic suite. Locks the per-kind priority
 * helpers and the deterministic ranking/cap/tiebreak.
 * -------------------------------------------------------------------------- */

test('priority helpers map sources into the worklist scale', () => {
  assert.equal(approvalPriority(), 90);
  assert.equal(velocityPriority('Stuck'), 78);
  assert.equal(velocityPriority('Slowing'), 52);
  assert.equal(reconnectPriority(100), 80);
  assert.equal(convictionPriority(0), 60); // low conviction → strong nudge
  assert.equal(convictionPriority(100), 0); // high conviction → none
});

test('helpers never produce NaN or out-of-range values', () => {
  assert.equal(reconnectPriority(Number.NaN), 0);
  assert.equal(convictionPriority(Number.NaN), 60);
  assert.ok(convictionPriority(50) >= 0 && convictionPriority(50) <= 100);
});

function a(
  over: Partial<NextAction> & { id: string; priority: number; kind: NextAction['kind'] }
): NextAction {
  return { title: over.id, detail: '', href: '/', ...over };
}

test('rankNextActions orders by priority desc and caps', () => {
  const ranked = rankNextActions(
    [
      a({ id: 'low', kind: 'conviction', priority: 20 }),
      a({ id: 'high', kind: 'approval', priority: 90 }),
      a({ id: 'mid', kind: 'reconnect', priority: 55 })
    ],
    2
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['high', 'mid']
  );
});

test('ties break by kind rank (approval > velocity > reconnect > conviction)', () => {
  const ranked = rankNextActions([
    a({ id: 'conv', kind: 'conviction', priority: 50 }),
    a({ id: 'appr', kind: 'approval', priority: 50 }),
    a({ id: 'velo', kind: 'velocity', priority: 50 })
  ]);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['appr', 'velo', 'conv']
  );
});

test('empty input yields empty worklist', () => {
  assert.deepEqual(rankNextActions([]), []);
});
