import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeConnections,
  providerAvailable,
  PROVIDER_ORDER,
  PROVIDER_COMING_SOON
} from './providers';
import type { ProviderConnection } from '@/lib/queries/integrations';

/* ----------------------------------------------------------------------------
 * Integrations merge-core regression suite (pure, icon-free module).
 *
 * Locks the contract the /integrations and /settings loaders depend on: every
 * known provider always renders in catalog order, DB rows thread through, the
 * early-access "requested" flag and the persisted sync_frequency are surfaced,
 * and availability is driven by the single PROVIDER_COMING_SOON source.
 * --------------------------------------------------------------------------*/

function row(overrides: Partial<ProviderConnection> & { provider: string }): ProviderConnection {
  return {
    status: 'connected',
    external_account: null,
    last_synced_at: null,
    sync_frequency: null,
    ...overrides
  };
}

test('PROVIDER_COMING_SOON has an entry for every ordered provider', () => {
  for (const p of PROVIDER_ORDER) {
    assert.equal(typeof PROVIDER_COMING_SOON[p], 'boolean', `missing availability for ${p}`);
  }
  // No stray keys beyond the ordered set.
  assert.equal(Object.keys(PROVIDER_COMING_SOON).length, PROVIDER_ORDER.length);
});

test('mergeConnections renders one view per known provider, in catalog order', () => {
  const views = mergeConnections([]);
  assert.equal(views.length, PROVIDER_ORDER.length);
  assert.deepEqual(
    views.map((v) => v.provider),
    PROVIDER_ORDER
  );
});

test('mergeConnections defaults an unconnected provider to a neutral view', () => {
  const view = mergeConnections([]).find((v) => v.provider === 'gmail');
  assert.ok(view);
  assert.equal(view.status, 'disconnected');
  assert.equal(view.external_account, null);
  assert.equal(view.last_synced_at, null);
  assert.equal(view.requested, false);
  assert.equal(view.sync_frequency, null);
});

test('mergeConnections threads a connected row through (incl. sync_frequency)', () => {
  const views = mergeConnections([
    row({
      provider: 'gmail',
      status: 'connected',
      external_account: 'ops@fund.com',
      last_synced_at: '2026-06-10T00:00:00Z',
      sync_frequency: 'hourly'
    })
  ]);
  const gmail = views.find((v) => v.provider === 'gmail');
  assert.ok(gmail);
  assert.equal(gmail.status, 'connected');
  assert.equal(gmail.external_account, 'ops@fund.com');
  assert.equal(gmail.last_synced_at, '2026-06-10T00:00:00Z');
  assert.equal(gmail.sync_frequency, 'hourly');
});

test('mergeConnections marks requested providers (array or Set) and leaves others false', () => {
  const fromArray = mergeConnections([], ['outlook']);
  assert.equal(fromArray.find((v) => v.provider === 'outlook')?.requested, true);
  assert.equal(fromArray.find((v) => v.provider === 'notion')?.requested, false);

  const fromSet = mergeConnections([], new Set(['dropbox', 'box']));
  assert.equal(fromSet.find((v) => v.provider === 'dropbox')?.requested, true);
  assert.equal(fromSet.find((v) => v.provider === 'box')?.requested, true);
  assert.equal(fromSet.find((v) => v.provider === 'gmail')?.requested, false);
});

test('providerAvailable is the inverse of PROVIDER_COMING_SOON', () => {
  for (const p of PROVIDER_ORDER) {
    assert.equal(providerAvailable(p), !PROVIDER_COMING_SOON[p]);
  }
});

test('availability matches known wired vs coming-soon providers', () => {
  assert.equal(providerAvailable('gmail'), true);
  assert.equal(providerAvailable('apollo'), true);
  assert.equal(providerAvailable('outlook'), false);
  assert.equal(providerAvailable('salesforce'), false);
});

test('view.available mirrors providerAvailable for every provider', () => {
  for (const view of mergeConnections([])) {
    assert.equal(view.available, providerAvailable(view.provider));
  }
});
