-- 20260702240000_finance_hardening.sql
-- Finance Phase 1 hardening (review follow-up, PR #482):
--   M3 — cross-org / cross-entity parent references. Foreign-key checks bypass
--   RLS, so a writer could point fin_entities.parent_entity_id or
--   fin_accounts.parent_account_id at another org's row, creating a dangling
--   cross-tenant hierarchy link. These triggers require a parent to belong to
--   the same organization (and, for accounts, the same entity).

create or replace function public.fin_entity_parent_same_org() returns trigger
language plpgsql as $$
begin
  if NEW.parent_entity_id is not null then
    if not exists (
      select 1 from public.fin_entities
      where id = NEW.parent_entity_id
        and organization_id = NEW.organization_id
    ) then
      raise exception 'fin: parent entity must belong to the same organization';
    end if;
    if NEW.parent_entity_id = NEW.id then
      raise exception 'fin: an entity cannot be its own parent';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists fin_entity_parent_same_org_trg on public.fin_entities;
create trigger fin_entity_parent_same_org_trg
  before insert or update on public.fin_entities
  for each row execute function public.fin_entity_parent_same_org();

create or replace function public.fin_account_parent_same_org() returns trigger
language plpgsql as $$
begin
  if NEW.parent_account_id is not null then
    -- A parent account must be in the same org AND the same entity as the child.
    if not exists (
      select 1 from public.fin_accounts
      where id = NEW.parent_account_id
        and organization_id = NEW.organization_id
        and entity_id = NEW.entity_id
    ) then
      raise exception 'fin: parent account must belong to the same organization and entity';
    end if;
    if NEW.parent_account_id = NEW.id then
      raise exception 'fin: an account cannot be its own parent';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists fin_account_parent_same_org_trg on public.fin_accounts;
create trigger fin_account_parent_same_org_trg
  before insert or update on public.fin_accounts
  for each row execute function public.fin_account_parent_same_org();
