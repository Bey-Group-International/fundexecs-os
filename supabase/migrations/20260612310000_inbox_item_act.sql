-- =====================================================================
-- Relationship Inbox — P2 ingest + triage support.
--
-- Additive + idempotent. Two changes:
--
--   1. Replace the partial unique index from P1 with a plain unique
--      constraint on (org_id, channel, external_id). A non-partial
--      constraint is what PostgREST needs as an upsert conflict target so
--      ingestion can dedupe rows idempotently. NULL external_id rows stay
--      allowed (NULLs are distinct under a unique constraint), so synthetic
--      rows without a provider id are unaffected.
--
--   2. `act_on_inbox_item` — the guarded triage transition, mirroring
--      `act_on_match`: a SECURITY DEFINER RPC that checks org membership,
--      only advances pending -> accepted/dismissed, optionally binds a
--      routed deal (validated to the same org), and stamps acted_at under a
--      row lock. Authenticated callers can't UPDATE inbox_items directly
--      (P1 RLS grants select only); this function is the sole write path.
-- =====================================================================

drop index if exists public.inbox_items_external_uniq;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inbox_items'::regclass
      and conname = 'inbox_items_external_key'
  ) then
    alter table public.inbox_items
      add constraint inbox_items_external_key unique (org_id, channel, external_id);
  end if;
end$$;

create or replace function public.act_on_inbox_item(
  _item_id uuid,
  _action text,
  _deal_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _org_id uuid;
  _status text;
begin
  if _action not in ('accepted', 'dismissed') then
    raise exception 'invalid action: %', _action using errcode = '22023';
  end if;

  select org_id, status into _org_id, _status
  from public.inbox_items
  where id = _item_id
  for update;

  if _org_id is null then
    raise exception 'inbox item not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.org_members om
    where om.org_id = _org_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Guard the transition: only a pending item can be actioned. A double
  -- action errors so the UI can revert its optimistic update.
  if _status <> 'pending' then
    raise exception 'inbox item already actioned' using errcode = '22023';
  end if;

  -- Validate any routed deal belongs to the same org before binding it, so a
  -- crafted call can't attach a conversation to a foreign deal.
  if _deal_id is not null and not exists (
    select 1 from public.deals d where d.id = _deal_id and d.org_id = _org_id
  ) then
    raise exception 'deal not in org' using errcode = '42501';
  end if;

  update public.inbox_items
  set status = _action,
      deal_id = coalesce(_deal_id, deal_id),
      acted_at = now()
  where id = _item_id;
end;
$$;

revoke all on function public.act_on_inbox_item(uuid, text, uuid) from public, anon;
grant execute on function public.act_on_inbox_item(uuid, text, uuid) to authenticated;
