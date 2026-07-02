-- 20260703010000_finance_hierarchy_cycle_lock.sql
-- Finance Phase 1 hardening — close the concurrent cycle-guard race found in
-- review of PR #485 (Codex M1). The recursive ancestor walk in
-- fin_entity_parent_same_org / fin_account_parent_same_org reads the hierarchy
-- without serialization, so under READ COMMITTED two concurrent reparents can
-- each pass the check independently and jointly form a loop:
--   TXN1: A.parent := B   (walk B→C, no cycle)      ✅ commits
--   TXN2: C.parent := A   (walk A→…, no cycle yet)   ✅ commits
--   → A → B → C → A        💥
--
-- Fix: take a per-organization transaction-level advisory lock before the check.
-- Parents are always same-org (enforced in the same trigger), so a per-org lock
-- covers every cycle a reparent could create; concurrent reparents in the org
-- serialize, and the second one re-reads the now-committed hierarchy and sees
-- the cycle. The lock is only taken when a parent is set (plain inserts stay
-- contention-free) and is released automatically at commit/rollback.
--
-- NB: a locking clause (FOR UPDATE) is not permitted inside a recursive CTE in
-- Postgres, so the advisory lock is the correct serialization primitive here.

create or replace function public.fin_entity_parent_same_org() returns trigger
language plpgsql as $$
begin
  if NEW.parent_entity_id is not null then
    -- Serialize concurrent reparents within this org (see file header).
    perform pg_advisory_xact_lock(
      hashtext('fin_entity_hierarchy'), hashtext(NEW.organization_id::text));
    if NEW.parent_entity_id = NEW.id then
      raise exception 'fin: an entity cannot be its own parent';
    end if;
    if not exists (
      select 1 from public.fin_entities
      where id = NEW.parent_entity_id
        and organization_id = NEW.organization_id
    ) then
      raise exception 'fin: parent entity must belong to the same organization';
    end if;
    -- Cycle guard: walking ancestors up from the proposed parent must never
    -- reach NEW.id. Existing rows are acyclic (this trigger keeps them so), so
    -- the recursive walk always terminates.
    if exists (
      with recursive ancestors as (
        select id, parent_entity_id
          from public.fin_entities where id = NEW.parent_entity_id
        union all
        select e.id, e.parent_entity_id
          from public.fin_entities e
          join ancestors a on e.id = a.parent_entity_id
      )
      select 1 from ancestors where id = NEW.id
    ) then
      raise exception 'fin: circular entity hierarchy detected';
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.fin_account_parent_same_org() returns trigger
language plpgsql as $$
begin
  if NEW.parent_account_id is not null then
    -- Serialize concurrent reparents within this org (see file header). Account
    -- cycles are within a single entity, so a per-org lock is a safe superset.
    perform pg_advisory_xact_lock(
      hashtext('fin_account_hierarchy'), hashtext(NEW.organization_id::text));
    if NEW.parent_account_id = NEW.id then
      raise exception 'fin: an account cannot be its own parent';
    end if;
    -- A parent account must be in the same org AND the same entity as the child.
    if not exists (
      select 1 from public.fin_accounts
      where id = NEW.parent_account_id
        and organization_id = NEW.organization_id
        and entity_id = NEW.entity_id
    ) then
      raise exception 'fin: parent account must belong to the same organization and entity';
    end if;
    -- Cycle guard (see fin_entity_parent_same_org for rationale).
    if exists (
      with recursive ancestors as (
        select id, parent_account_id
          from public.fin_accounts where id = NEW.parent_account_id
        union all
        select a.id, a.parent_account_id
          from public.fin_accounts a
          join ancestors anc on a.id = anc.parent_account_id
      )
      select 1 from ancestors where id = NEW.id
    ) then
      raise exception 'fin: circular account hierarchy detected';
    end if;
  end if;
  return NEW;
end $$;
