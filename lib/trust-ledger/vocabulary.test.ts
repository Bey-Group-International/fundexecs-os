import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockNumber,
  countByLayer,
  filterByLayer,
  LEDGER_LAYERS,
  ledgerLayerMeta,
  ledgerSource,
  ledgerToCsv,
  shortRecordId
} from './vocabulary';

/* ----------------------------------------------------------------------------
 * Chain of Trust ledger vocabulary regression suite.
 *
 * Locks the prototype's four-layer strip (order, counting, filtering), the
 * drawer's block numbering and real-id rendering, the source deep links,
 * and the CSV export shape.
 * --------------------------------------------------------------------------*/

test('the four proof layers are in proof order', () => {
  assert.deepEqual(
    LEDGER_LAYERS.map((l) => l.key),
    ['truth', 'concept', 'execution', 'work']
  );
  assert.equal(ledgerLayerMeta('execution').name, 'Proof of Execution');
  // Unknown keys fall back to the first layer rather than throwing.
  assert.equal(ledgerLayerMeta('junk').key, 'truth');
});

test('countByLayer counts records on their current layer', () => {
  const counts = countByLayer([
    { currentLayerKey: 'execution' },
    { currentLayerKey: 'execution' },
    { currentLayerKey: 'truth' }
  ]);
  assert.deepEqual(counts, { truth: 1, concept: 0, execution: 2, work: 0 });
});

test('filterByLayer narrows to one layer and "all" passes through', () => {
  const records = [
    { currentLayerKey: 'truth' as const, id: 'a' },
    { currentLayerKey: 'work' as const, id: 'b' }
  ];
  assert.deepEqual(
    filterByLayer(records, 'work').map((r) => r.id),
    ['b']
  );
  assert.equal(filterByLayer(records, 'all').length, 2);
});

test('block numbers count from the oldest record', () => {
  // Newest-first ledger of 8: the top row is block 0008, the last is 0001.
  assert.equal(blockNumber(0, 8), '0008');
  assert.equal(blockNumber(7, 8), '0001');
});

test('shortRecordId renders the real uuid like the prototype hash', () => {
  assert.equal(shortRecordId('9f2a44af-0000-4000-8000-00000000c7e1'), '9f2a…c7e1');
  assert.equal(shortRecordId('short'), 'short');
});

test('ledgerSource deep-links known surfaces and degrades honestly', () => {
  assert.equal(ledgerSource('wire').href, '/execute/wires');
  assert.equal(ledgerSource('diligence_finding').href, '/run/diligence');
  assert.equal(ledgerSource('formation_step').href, '/build/formation');
  const unknown = ledgerSource('mystery_thing');
  assert.equal(unknown.href, null);
  assert.equal(unknown.label, 'mystery thing');
});

test('ledgerToCsv orders oldest-first, numbers blocks, escapes cells', () => {
  const csv = ledgerToCsv([
    {
      id: 'b',
      title: 'Wire cleared, "Helios"',
      entityType: 'wire',
      entityId: 'w1',
      currentLayer: 'Proof of Execution',
      completion: 100,
      status: 'active',
      createdAt: '2026-06-12T10:00:00Z'
    },
    {
      id: 'a',
      title: 'KYC verified',
      entityType: 'member_profile',
      entityId: 'm1',
      currentLayer: 'Proof of Truth',
      completion: 25,
      status: 'active',
      createdAt: '2026-06-10T10:00:00Z'
    }
  ]);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^block,record_id,title/);
  assert.match(lines[1], /^0001,a,KYC verified/);
  assert.match(lines[2], /^0002,b,"Wire cleared, ""Helios"""/);
});
