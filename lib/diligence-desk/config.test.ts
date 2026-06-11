import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DD_AGENTS,
  DD_DEALS,
  DD_DEAL_META,
  DD_STATUS,
  dealAgentsCopy,
  dealReadiness,
  deriveVerdict,
  icReady,
  openAgents,
  resolveAgent,
  resolveSteps,
  riskRegister,
  type DDAgentMap
} from './config';

test('every deal has a state for every agent, and meta lines up', () => {
  for (const meta of DD_DEAL_META) {
    const deal = DD_DEALS[meta.id];
    assert.ok(deal, `missing deal ${meta.id}`);
    for (const a of DD_AGENTS) {
      const st = deal.agents[a.id];
      assert.ok(st, `${meta.id} missing agent ${a.id}`);
      assert.ok(DD_STATUS[st.status], `${meta.id}.${a.id} has unknown status ${st.status}`);
    }
  }
});

test('dealAgentsCopy deep-copies evidence arrays', () => {
  const copy = dealAgentsCopy(DD_DEALS.helios);
  copy.financial.evidence.push('Tampered');
  assert.ok(!DD_DEALS.helios.agents.financial.evidence.includes('Tampered'));
});

test('dealReadiness counts cleared workstreams and averages confidence', () => {
  const agents = dealAgentsCopy(DD_DEALS.helios);
  const r = dealReadiness(agents);
  assert.equal(r.total, DD_AGENTS.length);
  assert.equal(r.cleared, 4); // helios: financial, commercial, tech, esg clear
  assert.equal(r.pct, Math.round((4 / DD_AGENTS.length) * 100));
  assert.ok(r.avgConfidence > 0 && r.avgConfidence <= 100);
  assert.equal(r.totalChecks, 85);
});

test('verdict escalates worst-first: a high-severity flag puts the deal on hold', () => {
  const agents = dealAgentsCopy(DD_DEALS.helios); // legal flag is High severity
  const v = deriveVerdict(agents);
  assert.equal(v.label, 'On hold');
  assert.equal(v.tone, 'danger');
  assert.equal(icReady(agents), false);
});

test('riskRegister lists open items worst-severity first', () => {
  const agents = dealAgentsCopy(DD_DEALS.helios);
  const rows = riskRegister(agents);
  assert.equal(rows.length, openAgents(agents).length);
  assert.equal(rows[0].severity, 'High'); // legal sorts above the medium customer flag
  // Sorted non-increasing in severity rank.
  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rank[rows[i].severity] >= rank[rows[i - 1].severity]);
  }
});

test('resolveAgent clears an open workstream and lifts it to IC-ready', () => {
  const agents: DDAgentMap = dealAgentsCopy(DD_DEALS.helios);
  for (const a of openAgents(agents)) {
    agents[a.id] = resolveAgent(agents[a.id]);
  }
  assert.equal(icReady(agents), true);
  assert.equal(deriveVerdict(agents).label, 'Clear to proceed');
  assert.equal(dealReadiness(agents).cleared, DD_AGENTS.length);
  // Resolution lifts confidence to at least 90 and is idempotent on the headline.
  const legal = agents.legal;
  assert.ok(legal.confidence >= 90);
  assert.match(legal.headline, /^Resolved — /);
  const again = resolveAgent(legal);
  assert.equal(again.headline, legal.headline);
});

test('resolveSteps ends by logging to the Chain of Trust', () => {
  const agent = DD_AGENTS.find((a) => a.id === 'legal')!;
  const steps = resolveSteps(agent, DD_DEALS.helios.agents.legal);
  assert.ok(steps.length >= 2);
  assert.match(steps[0], /Adrian/);
  assert.match(steps[steps.length - 1], /Chain of Trust/);
});
