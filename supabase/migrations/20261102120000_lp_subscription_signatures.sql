-- 20261102120000_lp_subscription_signatures.sql
--
-- Subscription agreements signed in the LP portal, as a record that stands up.
--
-- Until now the portal stored only `subscription_signed_at`: no name, no email,
-- no copy of the agreement and nothing to show which text was signed. Each
-- signature now keeps the exact agreement text, its SHA-256, the signer's typed
-- name and the server's clock. There are two parties per session: the LP, then
-- the fund's countersigner (owner or admin). Written by the server only.

create table if not exists public.lp_subscription_signatures (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  session_id       uuid not null,
  party            text not null check (party in ('lp', 'gp')),
  signer_name      text not null check (char_length(btrim(signer_name)) between 1 and 120),
  signer_email     text not null,
  signed_at        timestamptz not null default now(),
  ip_hint          text,
  agreement_text   text not null,
  agreement_sha256 text not null check (agreement_sha256 ~ '^[0-9a-f]{64}$'),
  agreed           boolean not null default true,
  copy_sent_at     timestamptz,
  constraint lp_subscription_signatures_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade,
  -- One signature per party per session: a repeat is the same signature.
  constraint lp_subscription_signatures_one_per_party unique (session_id, party)
);

create index if not exists lp_subscription_signatures_org_idx
  on public.lp_subscription_signatures (organization_id);

alter table public.lp_subscription_signatures enable row level security;

drop policy if exists lp_subscription_signatures_select on public.lp_subscription_signatures;
create policy lp_subscription_signatures_select on public.lp_subscription_signatures
  for select using (organization_id in (select public.current_principal_org_ids()));

grant select on public.lp_subscription_signatures to authenticated;
grant select, insert, update, delete on public.lp_subscription_signatures to service_role;
