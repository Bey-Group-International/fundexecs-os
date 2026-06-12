-- ============================================================================
-- trust_anchoring — internal-first tamper-evidence for the Chain of Trust.
--
-- Every approval already writes a `trust_events` ledger row. Anchoring makes
-- that ledger tamper-EVIDENT: each event is committed as a salted hash (a
-- "leaf"), and leaves are periodically folded into a Merkle root (a "batch").
-- Recomputing any historical leaf and folding the batch proves a record is
-- byte-identical to what was committed — provable to anyone who trusts our
-- infrastructure, today, with ZERO third-party dependency.
--
-- Confidentiality is absolute: NO plaintext, file names, entity ids, or
-- metadata are ever exposed. A leaf is `sha256(salt || canonical_payload)`;
-- the salt is server-only (never granted to authenticated/anon), so even a
-- party holding a candidate document cannot confirm what was anchored. The
-- canonical payload is reconstructed server-side from `trust_events` at verify
-- time and is never stored here. Roots carry no org linkage by design.
--
-- Decision (docs/BLOCKCHAIN_TRUST_ANCHORING.md): internal-first. The optional
-- external witness (one public-chain root per window) is a later provider swap
-- with no schema change — `anchor_batches` already records `provider`,
-- `chain_id`, and `tx_hash`, which stay null under the `local` provider.
--
-- Mirrors the loop_events pattern (20260610090000): table-level RLS, writes via
-- SECURITY DEFINER RPCs so callers never need table-write grants. Additive +
-- idempotent.
-- ============================================================================

-- One Merkle root per fold window. No org column on purpose: a root reveals
-- neither which org, which records, nor how many beyond a coarse leaf_count.
create table if not exists public.anchor_batches (
  id          uuid primary key default gen_random_uuid(),
  merkle_root text not null,
  leaf_count  int not null check (leaf_count > 0),
  -- 'local' (internal, the MVP) or 'l2' (external witness, if ever enabled).
  provider    text not null default 'local' check (provider in ('local', 'l2')),
  -- Populated only when an external witness is enabled; null under 'local'.
  chain_id    text,
  tx_hash     text,
  anchored_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- One salted commitment per trust_event. `salt` is server-only and must never
-- reach a client (no authenticated grant below). `leaf_index` fixes the leaf's
-- position within its batch so the Merkle proof is reconstructable.
create table if not exists public.anchor_leaves (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  trust_event_id  uuid not null references public.trust_events (id) on delete cascade,
  leaf_hash       text not null,
  salt            text not null,
  payload_version int not null default 1,
  batch_id        uuid references public.anchor_batches (id) on delete set null,
  leaf_index      int,
  created_at      timestamptz not null default now(),
  -- One leaf per event — makes enqueue idempotent under retries.
  unique (trust_event_id)
);

-- Pending-leaf scan for the fold worker (leaves not yet in a batch).
create index if not exists anchor_leaves_pending_idx
  on public.anchor_leaves (created_at)
  where batch_id is null;
-- Ordered read of a batch's leaves when rebuilding a proof.
create index if not exists anchor_leaves_batch_idx
  on public.anchor_leaves (batch_id, leaf_index);
create index if not exists anchor_leaves_org_created_idx
  on public.anchor_leaves (org_id, created_at desc);

-- RLS — both tables are server-only. Salt and roots are read server-side via
-- the admin client behind an explicit authorization check (lib/queries/anchor),
-- never directly by a client. Writes go through the SECURITY DEFINER RPCs below.
alter table public.anchor_batches enable row level security;
alter table public.anchor_leaves enable row level security;

revoke all on table public.anchor_batches from anon, authenticated;
revoke all on table public.anchor_leaves from anon, authenticated;
grant select, insert, update, delete on table public.anchor_batches to service_role;
grant select, insert, update, delete on table public.anchor_leaves to service_role;

-- ----------------------------------------------------------------------------
-- enqueue_anchor_leaf — append one salted commitment for a trust_event.
--
-- Best-effort, idempotent (one leaf per trust_event). The leaf_hash + salt are
-- computed by the caller in Node (lib/anchor/merkle) and passed in; this RPC
-- only authorizes + persists, so authenticated callers need no table grant.
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_anchor_leaf(
  _org_id          uuid,
  _trust_event_id  uuid,
  _leaf_hash       text,
  _salt            text,
  _payload_version int default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _leaf_id uuid;
begin
  if _org_id is null or _trust_event_id is null then
    raise exception 'org_id and trust_event_id are required' using errcode = '22023';
  end if;
  if coalesce(trim(_leaf_hash), '') = '' or coalesce(trim(_salt), '') = '' then
    raise exception 'leaf_hash and salt are required' using errcode = '22023';
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

  insert into public.anchor_leaves (org_id, trust_event_id, leaf_hash, salt, payload_version)
  values (_org_id, _trust_event_id, trim(_leaf_hash), trim(_salt), coalesce(_payload_version, 1))
  on conflict (trust_event_id) do nothing
  returning id into _leaf_id;

  -- Already enqueued by a prior call — return the existing leaf id.
  if _leaf_id is null then
    select id into _leaf_id
    from public.anchor_leaves
    where trust_event_id = _trust_event_id;
  end if;

  return _leaf_id;
end;
$$;

revoke all on function public.enqueue_anchor_leaf(uuid, uuid, text, text, int)
  from public, anon;
grant execute on function public.enqueue_anchor_leaf(uuid, uuid, text, text, int)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- commit_anchor_batch — fold a set of pending leaves into one anchored batch.
--
-- Service-role only (the cron fold worker). The Merkle root is computed in Node
-- (lib/anchor/merkle) over the leaves in the given order; this RPC records the
-- batch and stamps each leaf with its batch id and ordinal position so the
-- proof can be rebuilt deterministically.
-- ----------------------------------------------------------------------------
create or replace function public.commit_anchor_batch(
  _merkle_root text,
  _leaf_ids    uuid[],
  _provider    text default 'local',
  _chain_id    text default null,
  _tx_hash     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _batch_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'commit_anchor_batch is service-role only' using errcode = '42501';
  end if;
  if coalesce(trim(_merkle_root), '') = '' then
    raise exception 'merkle_root is required' using errcode = '22023';
  end if;
  if _leaf_ids is null or array_length(_leaf_ids, 1) is null then
    raise exception 'at least one leaf id is required' using errcode = '22023';
  end if;

  insert into public.anchor_batches (merkle_root, leaf_count, provider, chain_id, tx_hash)
  values (
    trim(_merkle_root),
    array_length(_leaf_ids, 1),
    coalesce(nullif(trim(coalesce(_provider, '')), ''), 'local'),
    nullif(trim(coalesce(_chain_id, '')), ''),
    nullif(trim(coalesce(_tx_hash, '')), '')
  )
  returning id into _batch_id;

  update public.anchor_leaves al
  set batch_id = _batch_id,
      leaf_index = (t.ord - 1)
  from unnest(_leaf_ids) with ordinality as t(leaf_id, ord)
  where al.id = t.leaf_id
    and al.batch_id is null;

  return _batch_id;
end;
$$;

revoke all on function public.commit_anchor_batch(text, uuid[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.commit_anchor_batch(text, uuid[], text, text, text)
  to service_role;
