-- One share row per (session, org, scope).
--
-- `session_shares` has only ever enforced token uniqueness, and
-- `createSessionShare` inserted unconditionally from migration 0018 until the
-- change that accompanies this one — a fresh row and a fresh live token on
-- every click of "Share with your team". Nothing read those extra rows back,
-- so a session could accumulate live links its owner could neither see nor
-- revoke.
--
-- The dedup below keeps the earliest row per triple, which is the one the
-- application now hands out. It is written defensively rather than because
-- production needs it: this table is empty there, so no link is revoked by
-- this migration. Other environments may not be empty, and the index cannot
-- build while duplicates exist.
delete from public.session_shares s
where exists (
  select 1
  from public.session_shares keep
  where keep.session_id = s.session_id
    and keep.organization_id = s.organization_id
    and keep.scope = s.scope
    and (keep.created_at, keep.id) < (s.created_at, s.id)
);

-- Plain, not CONCURRENTLY: the table is empty-to-tiny, so the brief lock costs
-- nothing, and CONCURRENTLY cannot run inside the transaction a migration is
-- applied in.
create unique index if not exists session_shares_session_org_scope_idx
  on public.session_shares (session_id, organization_id, scope);

comment on index public.session_shares_session_org_scope_idx is
  'One share per session per scope. Lets share creation upsert on conflict instead of racing a lookup-then-insert.';
