-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
do $$
declare
  t text;
  managed text[] := array[
    'investors', 'deals', 'partners', 'service_providers', 'debt_facilities',
    'underwritings', 'diligence_items', 'capital_events', 'assets'
  ];
begin
  foreach t in array managed loop
    execute format($f$
      alter table public.%1$I
        add column if not exists provenance text not null default 'manual',
        add column if not exists verification_status text not null default 'unverified',
        add column if not exists verified_at timestamptz,
        add column if not exists verified_by uuid references public.principals (id) on delete set null,
        add column if not exists verification_note text,
        add column if not exists archived_at timestamptz;
    $f$, t);

    execute format(
      'create index if not exists %1$I on public.%2$I (organization_id) where archived_at is null;',
      t || '_live_idx', t
    );
  end loop;
end $$;;
