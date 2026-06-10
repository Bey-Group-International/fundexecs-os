/* ============================================================================
 * lib/integrations/sync-frequency.ts — the single source of truth for an
 * integration connection's sync cadence.
 *
 * Shared by the persistence route (POST /api/integrations/:provider/frequency),
 * the Manage-panel selector (IntegrationCard), and the DB check constraint on
 * integration_connections.sync_frequency. Keeping the allowed set in one pure,
 * dependency-free module means the client options, the server validation, and
 * the column constraint can't drift apart. No React, no icons — safe to import
 * anywhere (server route, client component, unit test).
 * ========================================================================= */

/** Allowed cadences, mirrored by the DB check constraint (migration 20260610150000). */
export const SYNC_FREQUENCIES = ['realtime', 'hourly', 'daily', 'manual'] as const;

export type SyncFrequency = (typeof SYNC_FREQUENCIES)[number];

/** Default cadence for a freshly connected provider (matches the column default). */
export const DEFAULT_SYNC_FREQUENCY: SyncFrequency = 'realtime';

/** Human labels for the selector, in display order. */
export const SYNC_FREQUENCY_OPTIONS: ReadonlyArray<{ value: SyncFrequency; label: string }> = [
  { value: 'realtime', label: 'Real-time' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Daily' },
  { value: 'manual', label: 'Manual only' }
];

/** Narrowing guard for untrusted input (request bodies, stored values). */
export function isSyncFrequency(value: unknown): value is SyncFrequency {
  return typeof value === 'string' && (SYNC_FREQUENCIES as readonly string[]).includes(value);
}

/** Coerce any value to a valid cadence, falling back to the default. */
export function toSyncFrequency(value: unknown): SyncFrequency {
  return isSyncFrequency(value) ? value : DEFAULT_SYNC_FREQUENCY;
}
