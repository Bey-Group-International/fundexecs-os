-- 0032_record_provenance.sql
-- Verifiable, archivable records across every table-backed module (Source, Run,
-- Execute). Each record gains:
--   • provenance          — how it entered the system (manual / ai / import)
--   • verification_status — unverified | verified
--   • verified_at / by    — who confirmed it and when
--   • verification_note   — the evidence behind a verification (a URL or note)
--   • archived_at         — soft-archive; live lists and dashboards hide these
--
-- Hard delete needs no new policy: the existing `*_write` policies are FOR ALL,
-- so org writers can already UPDATE (archive/verify) and DELETE these rows.
-- `provenance` (not `source`) is used to avoid colliding with deals.source.

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

    -- Speeds up the live-list / dashboard reads, which always filter to
    -- non-archived rows for an org.
    execute format(
      'create index if not exists %1$I on public.%2$I (organization_id) where archived_at is null;',
      t || '_live_idx', t
    );
  end loop;
end $$;
