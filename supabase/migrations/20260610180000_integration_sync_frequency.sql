-- ============================================================================
-- integration_connections.sync_frequency — persist the per-connection sync
-- cadence the member picks in the Integrations "Manage" panel.
--
-- The panel's frequency selector (realtime / hourly / daily / manual) only ever
-- wrote to localStorage, so the choice was device-local and invisible to the
-- server — a "preference" with no backend effect. Storing it on the connection
-- row makes it durable, cross-device, and readable by a future scheduler.
-- Additive + idempotent.
-- ============================================================================

alter table public.integration_connections
  add column if not exists sync_frequency text not null default 'realtime';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integration_connections_sync_frequency_check'
      and conrelid = 'public.integration_connections'::regclass
  ) then
    alter table public.integration_connections
      add constraint integration_connections_sync_frequency_check
      check (sync_frequency in ('realtime', 'hourly', 'daily', 'manual'));
  end if;
end$$;
