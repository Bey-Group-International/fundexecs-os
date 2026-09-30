-- A way to take a machine-written entry off the wrong person's record.
--
-- The CRM now writes entries nobody typed: a meeting writes itself onto the
-- record of everyone who was in it (20260930083000), and an inbox conversation
-- onto the record of the person on the other end (20260930090000). Both can be
-- wrong about WHO. A meeting invite can carry a colleague's address by mistake,
-- an inbound email's From header is written by whoever sent it, and a summary can
-- simply describe the wrong person's business.
--
-- Until now there was no way to fix that. network_activities_update restricts a
-- member to their OWN, non-system entries, and that restriction is deliberate --
-- it is what makes the timeline evidence rather than opinion. The consequence was
-- that a machine-written entry on the wrong record was PERMANENT for everyone who
-- could see it.
--
-- So: mark, do not edit and do not delete.
--
-- Editing the body would destroy the property is_system exists for -- that the
-- row says what the app observed, not what somebody would prefer it said. And
-- deleting the row would be silently undone. The writers upsert on
-- (organization_id, contact_id, thread_id) and on
-- (organization_id, contact_id, meeting_id); the inbox writer re-matches on the
-- address every time the thread receives a reply, so a deleted row simply comes
-- back on the next message, unmarked. KEEPING the row with its contact_id is what
-- makes the correction durable: the next reply conflicts with the marked row and
-- updates its content, and the row stays hidden because the mark is not in the
-- writers' payload and so survives the upsert.

alter table public.network_activities
  add column if not exists misattributed_at timestamptz,
  add column if not exists misattributed_by uuid,
  add column if not exists misattribution_reason text;

comment on column public.network_activities.misattributed_at is
  'Set when someone with authority established this machine-written entry is about the wrong contact. The row is kept as evidence and hidden from the timeline; the writers'' upsert does not clear it, so a later message updates a row that stays hidden.';

-- The reference is added separately and NOT VALID on purpose.
--
-- Declared inline it would be validated immediately, which SCANS
-- network_activities. This table is the CRM's timeline, written by the meeting
-- and inbox paths, so on a busy org that scan is a real outage.
--
-- Be precise about what NOT VALID buys, because it is easy to overstate: it
-- skips the check of EXISTING rows, and nothing else. Adding the constraint
-- still takes SHARE ROW EXCLUSIVE on network_activities AND on principals, and
-- Postgres holds those locks until the transaction ends. So this avoids the
-- scan, not the locks -- which is why the index that used to sit below is now in
-- its own migration, rather than extending those locks for the length of a
-- build.
--
-- The constraint is otherwise fully live: new and updated rows are checked, and
-- ON DELETE SET NULL still fires when a principal is removed. And every existing
-- row is NULL, because the column was created in the statement above — so a later
--   alter table public.network_activities
--     validate constraint network_activities_misattributed_by_fkey;
-- is guaranteed to succeed and can be run whenever convenient. It is not needed
-- for the constraint to do its job.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'network_activities_misattributed_by_fkey'
  ) then
    alter table public.network_activities
      add constraint network_activities_misattributed_by_fkey
      foreign key (misattributed_by) references public.principals (id)
      on delete set null
      not valid;
  end if;
end $$;

-- The partial index the timeline read needs is in its own migration,
-- 20260930110000_network_activities_contact_visible_idx.sql, and deliberately
-- not here. Adding the constraint above takes SHARE ROW EXCLUSIVE on
-- network_activities and principals, and Postgres holds those until the
-- transaction ends -- so building an index in the same transaction keeps both
-- tables locked against writes for the length of the build as well. Separate
-- files are separate transactions, so the constraint's locks release first.


/**
 * Mark (or unmark) a machine-written entry as being about the wrong contact.
 *
 * SECURITY DEFINER for the same reason merge_network_contacts is: the operation
 * is legitimate but RLS correctly forbids it from the client, so every check the
 * policies would have made is made here instead. Over PostgREST the update would
 * match zero rows, report no error, and the caller would believe it had worked.
 *
 * Authorization is deliberately NOT ordinary edit rights. A system entry belongs
 * to no member -- actor_id is the principal who happened to end the meeting, or
 * null for an ingest -- so "your own entries" has no meaning here. It takes an
 * org admin, and the entry's contact must be one the caller can already see.
 */
create or replace function public.flag_network_activity_misattributed(
  activity_id uuid,
  reason text default null,
  flag boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := (select auth.uid());
  row_org    uuid;
  row_contact uuid;
  row_system boolean;
begin
  select organization_id, contact_id, is_system
    into row_org, row_contact, row_system
    from public.network_activities
   where id = activity_id;

  if row_org is null then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  -- DEFINER has bypassed RLS, so every check the policies would have made is
  -- made here. Three of them, in this order, and the order is the point.
  --
  -- MEMBERSHIP FIRST, answering exactly as it does for an id that is not there.
  -- Combined with the right check below -- which is how this was first written --
  -- somebody outside the organisation got one answer for a row that exists and a
  -- different one for a row that does not, which tells them which ids are real in
  -- an organisation they cannot see. Ids are uuids so nobody enumerates them, but
  -- a cross-tenant existence oracle is not something to leave in place on that
  -- basis. The check two statements down already had this discipline for a
  -- contact the caller cannot see; membership did not, and the comment that used
  -- to sit here described the design it failed to implement.
  --
  -- Written as `not exists` over the helper rather than `row_org not in (...)`
  -- deliberately: NOT IN against a set containing a null yields null, the guard
  -- would not fire, and a non-member would be let through by the one statement
  -- meant to stop them.
  if caller is null
     or not exists (
       select 1 from public.current_principal_org_ids() as org where org = row_org
     )
  then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  -- THE RIGHT SECOND, and this one is named honestly. A member can already read
  -- the organisation's entries, so telling them they lack the right discloses
  -- nothing they could not see for themselves.
  if not public.is_org_admin(row_org) then
    raise exception 'Only an organization admin can correct an automatic entry'
      using errcode = '42501';
  end if;

  -- VISIBILITY THIRD, through the same helper the SELECT policy uses, so an
  -- admin cannot reach a private contact they could not otherwise see.
  if row_contact is not null and not public.network_contact_visible(row_contact) then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  -- Hand-written entries already have an owner and ordinary edit and delete
  -- rights. Routing them through here would let an admin quietly hide a
  -- colleague's note, which is a different power than correcting the engine.
  if not row_system then
    raise exception 'Only an automatic entry is corrected this way'
      using errcode = '22023';
  end if;

  update public.network_activities
     set misattributed_at = case when flag then now() else null end,
         misattributed_by = case when flag then caller else null end,
         misattribution_reason = case when flag then nullif(btrim(coalesce(reason, '')), '') else null end
   where id = activity_id;

  -- Recency is denormalised onto the contact by an AFTER INSERT trigger
  -- (network_contact_touch_activity), so hiding the entry is only half the
  -- correction: the contact would still look as recently active as the wrong
  -- entry made them. Recomputed from the entries that remain.
  --
  -- Left alone when none remain: last_activity_at was backfilled from
  -- strength_updated_at/updated_at/created_at for contacts that never had an
  -- activity, and clearing it would destroy that rather than correct anything.
  -- Both statements are scoped to the organisation the admin check was made
  -- against, belt and braces. A row whose contact_id points outside its own org
  -- should not exist -- both writers resolve the contact by organization_id, and
  -- the insert policy requires network_contact_visible -- but they hold
  -- service-role clients that bypass RLS, and this function bypasses it too, so
  -- one malformed row would otherwise let a correction reach another org's
  -- contact. Cheaper to state than to rely on.
  if row_contact is not null then
    update public.network_contacts c
       set last_activity_at = sub.newest,
           updated_at = now()
      from (
        select max(a.occurred_at) as newest
          from public.network_activities a
         where a.contact_id = row_contact
           and a.organization_id = row_org
           and a.misattributed_at is null
      ) sub
     where c.id = row_contact
       and c.organization_id = row_org
       and sub.newest is not null
       and (c.last_activity_at is null or c.last_activity_at <> sub.newest);
  end if;

  -- The trail is written HERE, not by the caller, and that is the point.
  --
  -- This is a privileged act whose whole effect is to hide machine-written
  -- evidence from a record, so "it happened and nobody can tell who did it" is
  -- the one outcome that must be impossible. Audited from the route instead, it
  -- was neither atomic nor reliably attributed:
  --
  --   * recordNetworkAudit swallows its own failures (lib/network-audit.ts: it
  --     catches and console.warns). The correction had already committed by then,
  --     so a failed insert left a hidden entry and no record of the hiding.
  --   * the route passed the CALLER'S CURRENT org, which is not necessarily this
  --     activity's org. A principal who administers two organisations, acting in
  --     one session context on an entry belonging to the other, filed the trail
  --     under the wrong organisation -- where the people who would notice cannot
  --     see it.
  --
  -- In here it shares the statement's transaction: the correction and its trail
  -- commit together or not at all, and `row_org` is the organisation the admin
  -- right was actually checked against.
  --
  -- 'update' because network_audit_log.action has a CHECK constraint and there is
  -- no 'correct' in it; the metadata carries which direction this was.
  insert into public.network_audit_log (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    row_org,
    caller,
    'update',
    'network_activity',
    activity_id,
    jsonb_build_object(
      'misattributed', flag,
      'reason', nullif(btrim(coalesce(reason, '')), ''),
      'contact_id', row_contact
    )
  );

  return jsonb_build_object(
    'activity_id', activity_id,
    'misattributed', flag,
    'contact_id', row_contact,
    'organization_id', row_org
  );
end;
$$;

revoke all on function public.flag_network_activity_misattributed(uuid, text, boolean) from public;
grant execute on function public.flag_network_activity_misattributed(uuid, text, boolean) to authenticated;

comment on function public.flag_network_activity_misattributed(uuid, text, boolean) is
  'Marks a machine-written network_activities row as being about the wrong contact, hiding it from the timeline while keeping it as evidence, and recomputes the contact''s last_activity_at from what remains. Org admin only.';
