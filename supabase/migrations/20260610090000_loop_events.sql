-- ============================================================================
-- loop_events — per-verb instrumentation for the operating loop.
--
-- The loop (Build → Source → Run → Drive) already *acts* (recordLoopClose
-- credits proof layers via the trust_events ledger), but nothing records the
-- verbs' activity as analyzable data. This append-only stream is the substrate
-- the compounding work reads from: which verb fired, what event, against which
-- entity — feeding the intelligence flywheel, per-verb scorecards, and future
-- match-tuning without re-deriving history from N feature tables.
--
-- Deliberately separate from trust_events: that table is a *ledger* with
-- idempotency semantics (one credit per entity); this one is telemetry —
-- multiple events per entity are expected and meaningful.
--
-- Mirrors the sibling snapshot/RPC pattern (trust_posture_snapshots,
-- 20260609220000): table-level RLS for member reads, writes through a
-- SECURITY DEFINER RPC so callers never need table-write grants. Additive +
-- idempotent.
-- ============================================================================

create table if not exists public.loop_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  -- The acting user (auth.uid() at emit time); null for system/cron emits.
  actor_id    uuid references public.profiles (id) on delete set null,
  -- Which loop verb the event belongs to.
  verb        text not null check (verb in ('build', 'source', 'run', 'drive')),
  -- Short machine name, e.g. 'loop_closed', 'gate_cleared', 'launcher_opened'.
  event_type  text not null check (char_length(event_type) between 1 and 64),
  -- Optional subject, e.g. ('deal', <uuid>) or ('diligence_run', <uuid>).
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Per-verb activity reads ("what happened in Drive this week") and org-wide
-- recency reads both stay index-only.
create index if not exists loop_events_org_verb_created_idx
  on public.loop_events (org_id, verb, created_at desc);
create index if not exists loop_events_org_created_idx
  on public.loop_events (org_id, created_at desc);

-- RLS — org members read their own org's stream. Writes go through the
-- SECURITY DEFINER RPC below; authenticated gets no table-write grant.
alter table public.loop_events enable row level security;

revoke all on table public.loop_events from anon, authenticated;
grant select on table public.loop_events to authenticated;
grant select, insert, update, delete on table public.loop_events to service_role;

drop policy if exists "members read loop_events" on public.loop_events;
create policy "members read loop_events"
  on public.loop_events
  for select to authenticated
  using (private.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- log_loop_event — best-effort, append-only emit.
--
-- One authorized call appends one event. SECURITY DEFINER with an empty
-- search_path and an explicit membership check (service_role bypasses, for
-- cron/system emits). The actor is taken from auth.uid(), never from the
-- caller's arguments, so an event can't be attributed to someone else.
-- ----------------------------------------------------------------------------
create or replace function public.log_loop_event(
  _org_id      uuid,
  _verb        text,
  _event_type  text,
  _entity_type text default null,
  _entity_id   uuid default null,
  _metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _org_id is null then
    raise exception 'org_id is required' using errcode = '22023';
  end if;
  if _verb is null or _verb not in ('build', 'source', 'run', 'drive') then
    raise exception 'invalid loop verb %', _verb using errcode = '22023';
  end if;
  if coalesce(trim(_event_type), '') = '' then
    raise exception 'event_type is required' using errcode = '22023';
  end if;

  -- Authorize: the cron (service_role) or an active member of the org.
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org_id
         and om.user_id = auth.uid()
         and om.status = 'active'
     )
  then
    raise exception 'not a member of org %', _org_id using errcode = '42501';
  end if;

  insert into public.loop_events (org_id, actor_id, verb, event_type, entity_type, entity_id, metadata)
  values (
    _org_id,
    auth.uid(),
    _verb,
    trim(_event_type),
    nullif(trim(coalesce(_entity_type, '')), ''),
    _entity_id,
    coalesce(_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_loop_event(uuid, text, text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.log_loop_event(uuid, text, text, text, uuid, jsonb)
  to authenticated, service_role;
