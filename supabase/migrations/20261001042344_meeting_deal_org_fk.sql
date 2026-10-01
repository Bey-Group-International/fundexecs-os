-- live_meetings.deal_id: replace a single-column foreign key with a composite
-- one, so a meeting can only reference a deal in its OWN organisation.
--
-- This migration differs from its two predecessors in three ways worth reading
-- before changing it:
--
--   1. The column already HAS a foreign key, so this REPLACES rather than adds.
--      That makes it the only one of the three with a destructive step.
--   2. deal_id is genuinely wired into the product. The other three related_*
--      columns are barely or not at all.
--   3. No index is created here, because a correct one already exists.

-- ---------------------------------------------------------------------------
-- What was already there, and why it was not enough
-- ---------------------------------------------------------------------------
--
-- The existing constraint is
--
--   live_meetings_deal_id_deals_fkey
--     FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL
--
-- It stops deal_id holding a UUID that is not a deal. It does NOT stop a
-- meeting in organisation A referencing a deal in organisation B, because it
-- constrains the id alone and says nothing about the tenant.
--
-- That is not a deduction. Measured against production, in a rolled-back
-- transaction, with a real deal created in a real second organisation:
--
--   BEFORE (the existing single-column fk), cross-org deal   ACCEPTED
--   AFTER  (the composite fk below),        cross-org deal   REJECTED
--
-- Whoever may edit a meeting supplies deal_id -- the same CWE-639 shape as
-- inbox_thread_drafts, related_contact_id (20261001001500) and related_fund_id
-- (20261001033517). Of the four, this is the one that matters most in practice,
-- because it is the one the product actually uses: lib/meetings/meeting-context.ts
-- passes it to loadDeal(), which queries
--
--   .from("deals").eq("id", dealId).eq("organization_id", orgId)
--
-- so the organisation filter already exists in the read and is already relied
-- on. The composite key makes it a property of the data instead of a habit of
-- one function, and after this that `.eq("organization_id", orgId)` can never
-- discard a row.

-- The composite reference needs a unique key to point at. `id` is already the
-- primary key of deals, so this adds no constraint the table did not have --
-- it only makes (id, organization_id) nameable as a foreign-key target. Same
-- shape as funds_id_org_uniq and network_contacts_id_org_uniq.
create unique index if not exists deals_id_org_uniq
  on public.deals (id, organization_id);

-- The swap, in ONE block so it cannot half-happen.
--
-- `supabase db push` runs a migration in a transaction, so a failure would roll
-- the whole file back. But migrations in this repository also get applied out
-- of band by hand, and a hand-run that dropped the old key and then failed to
-- add the new one would leave deal_id completely unconstrained. Keeping both
-- statements inside a single DO block, gated on the NEW constraint's absence,
-- makes that state unreachable and the file re-runnable:
--
--   first run   new fk absent  -> drop the old, add the new
--   second run  new fk present -> do nothing at all
--
-- ON DELETE SET NULL names its column, and the column list is load-bearing for
-- the same reason as in the two predecessors. WITHOUT the list PostgreSQL nulls
-- EVERY referencing column, taking the meeting's organization_id with it -- and
-- live_meetings_select reads
--
--   ((organization_id IS NULL) OR (organization_id IN ( SELECT ... )))
--
-- so a row whose organization_id has been nulled is readable by every
-- authenticated user. Deleting one deal would silently publish that meeting.
-- Measured: after deleting the referenced deal, deal_id became NULL and
-- organization_id was unchanged.
--
-- ON UPDATE stays at NO ACTION: moving a deal between organisations while a
-- meeting references it should fail loudly rather than silently re-point or
-- detach the meeting. This matches the old constraint, which also left
-- ON UPDATE at its default.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_deal_org_fk'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      drop constraint if exists live_meetings_deal_id_deals_fkey;

    alter table public.live_meetings
      add constraint live_meetings_deal_org_fk
      foreign key (deal_id, organization_id)
      references public.deals (id, organization_id)
      on delete set null (deal_id);
  end if;
end $$;

-- A composite foreign key is MATCH SIMPLE: if ANY of its columns is NULL the
-- constraint is not checked AT ALL. live_meetings.organization_id is nullable,
-- so without this check a row with organization_id = NULL could carry any value
-- whatever in deal_id and the key above would never look.
--
-- Note that deals.organization_id is NOT NULL, which does NOT help: the hole is
-- on the REFERENCING side, in live_meetings. Measured with the key in place and
-- the check dropped, a null-organisation row carrying a random UUID was
-- ACCEPTED; with the check it is refused. 0 of 62 production rows have a NULL
-- organization_id, so this forbids a shape that exists only in the schema.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_deal_needs_org'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_deal_needs_org
      check (deal_id is null or organization_id is not null);
  end if;
end $$;

-- DELIBERATELY NO INDEX HERE.
--
-- The two predecessors each created one, because the foreign key leaves the
-- REFERENCING side unindexed and every delete from the referenced table would
-- otherwise scan live_meetings sequentially. That reasoning applies here too --
-- but the index already exists, and is already the right shape:
--
--   live_meetings_deal_id_idx
--     CREATE INDEX ... ON public.live_meetings USING btree (deal_id)
--     WHERE (deal_id IS NOT NULL)
--
-- Partial on exactly the predicate this migration would have chosen. Adding a
-- second index on the same column would cost writes and buy nothing.
