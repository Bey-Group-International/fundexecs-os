-- 20261009171326_data_room_positions_atomic.sql
-- Make data-room positions distinct, and their allocation atomic (issue #1077).
--
-- `nextSortOrder` in room-actions.ts was a read followed by a write with
-- nothing serialising the two: two publications racing in the same room both
-- read the same maximum and both landed on the same position, because the
-- manifest's only unique constraint is (room_id, document_id). Every reader
-- breaks ties by document name, so the collision was stable rather than
-- chaotic — but the two documents sorted alphabetically against each other
-- instead of in the order they were published, and the room stopped
-- guaranteeing distinct positions.
--
-- Three parts, in dependency order:
--   1. Renumber every room's manifest sequentially, clearing the duplicates
--      that already exist — the unique constraint cannot be created over them.
--   2. A unique constraint on (room_id, sort_order). DEFERRABLE INITIALLY
--      DEFERRED, because a reorder exchanges two rows' positions and the
--      intermediate state inside that transaction briefly holds the same
--      value twice; checking at commit admits the swap and still refuses any
--      transaction that ENDS with a duplicate. (A plain unique index checks
--      per row and would reject the swap's first update.)
--   3. Two functions that do the writes inside one transaction each:
--      publish_room_document allocates max+1 and inserts it atomically, and
--      swap_room_document_positions exchanges two rows' positions. Both take
--      a per-room advisory lock first, so concurrent callers in the same room
--      serialise instead of reading the same maximum.
--
-- SECURITY INVOKER on both functions, deliberately: the caller's own RLS on
-- data_room_documents (writer-write) and data_rooms (member-read) still
-- decides what they may see and change — the functions add atomicity, not
-- privilege.

-- ---------------------------------------------------------------------------
-- 1. Clear existing duplicates: renumber each room's manifest 0..n-1 in the
-- order every reader already presents it — sort_order, then document name
-- (groupRoomDocuments, buildViewerPayload, moveRoomDocument all break ties by
-- name), then id so the pass itself is deterministic. Rows already in
-- sequence are left untouched.
-- ---------------------------------------------------------------------------
with ranked as (
  select m.id,
         row_number() over (
           partition by m.room_id
           order by m.sort_order, coalesce(d.name, ''), m.id
         ) - 1 as pos
    from public.data_room_documents m
    left join public.documents d on d.id = m.document_id
)
update public.data_room_documents m
   set sort_order = r.pos
  from ranked r
 where m.id = r.id
   and m.sort_order is distinct from r.pos;

-- ---------------------------------------------------------------------------
-- 2. Distinct positions, enforced. The constraint's backing index also serves
-- the (room_id, sort_order) ordering scans, so the old plain index is
-- redundant and goes.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'data_room_documents_room_pos_key'
       and conrelid = 'public.data_room_documents'::regclass
  ) then
    alter table public.data_room_documents
      add constraint data_room_documents_room_pos_key
      unique (room_id, sort_order) deferrable initially deferred;
  end if;
end $$;

drop index if exists public.data_room_documents_room_idx;

-- ---------------------------------------------------------------------------
-- 3a. Atomic publish. Returns true when the document was newly published,
-- false when it was already in the room (the idempotent re-publish) or when
-- the room or document is not the caller's to publish into.
-- ---------------------------------------------------------------------------
create or replace function public.publish_room_document(
  p_organization_id uuid,
  p_room_id uuid,
  p_document_id uuid,
  p_added_by uuid
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The same org checks the server action makes, re-made here because the
  -- function is callable directly: a stray room or document id from another
  -- firm publishes nothing. Both reads run under the caller's RLS.
  if not exists (
    select 1 from public.data_rooms r
     where r.id = p_room_id and r.organization_id = p_organization_id
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.documents d
     where d.id = p_document_id and d.organization_id = p_organization_id
  ) then
    return false;
  end if;

  -- Serialise allocations per room. An advisory transaction lock rather than
  -- FOR UPDATE on the room row, so locking needs no update rights on
  -- data_rooms and touches no row versions.
  perform pg_advisory_xact_lock(hashtextextended('data_room_documents:' || p_room_id::text, 0));

  insert into public.data_room_documents
         (organization_id, room_id, document_id, sort_order, added_by)
  select p_organization_id, p_room_id, p_document_id,
         coalesce(max(m.sort_order) + 1, 0), p_added_by
    from public.data_room_documents m
   where m.room_id = p_room_id
  on conflict (room_id, document_id) do nothing;
  return found;
end;
$$;

comment on function public.publish_room_document(uuid, uuid, uuid, uuid) is
  'Publish a document into a data room at the next free position, allocated under a per-room lock so concurrent publishes serialise instead of colliding. Idempotent: re-publishing returns false and changes nothing. Runs under the caller''s own RLS.';

grant execute on function public.publish_room_document(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.publish_room_document(uuid, uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3b. Atomic reorder: exchange two manifest rows' positions. The deferred
-- constraint admits the in-transaction duplicate and checks the final state.
-- Returns false when either row is missing — the room changed under the
-- operator — so the action can say so instead of half-moving.
-- ---------------------------------------------------------------------------
create or replace function public.swap_room_document_positions(
  p_organization_id uuid,
  p_room_id uuid,
  p_document_id uuid,
  p_other_document_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pos integer;
  v_other_pos integer;
begin
  if p_document_id = p_other_document_id then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('data_room_documents:' || p_room_id::text, 0));

  select m.sort_order into v_pos
    from public.data_room_documents m
   where m.room_id = p_room_id
     and m.organization_id = p_organization_id
     and m.document_id = p_document_id;
  select m.sort_order into v_other_pos
    from public.data_room_documents m
   where m.room_id = p_room_id
     and m.organization_id = p_organization_id
     and m.document_id = p_other_document_id;
  if v_pos is null or v_other_pos is null then
    return false;
  end if;

  update public.data_room_documents m
     set sort_order = case m.document_id
                        when p_document_id then v_other_pos
                        when p_other_document_id then v_pos
                      end
   where m.room_id = p_room_id
     and m.organization_id = p_organization_id
     and m.document_id in (p_document_id, p_other_document_id);
  return true;
end;
$$;

comment on function public.swap_room_document_positions(uuid, uuid, uuid, uuid) is
  'Exchange two documents'' positions in a data room in one transaction, under the same per-room lock as publishing. Returns false when either row is gone. Runs under the caller''s own RLS.';

grant execute on function public.swap_room_document_positions(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.swap_room_document_positions(uuid, uuid, uuid, uuid) to service_role;
