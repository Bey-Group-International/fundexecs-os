-- =====================================================================
-- W1 — Public raise / campaign page (StartEngine-style) + inbound interest.
--
-- `raise_pages`     : an org owner/admin publishes a token-gated public raise
--                     page (/r/<token>). The public route reads it with the
--                     service-role admin client and renders ONLY a safe subset
--                     (org name, owner name, member type, an owner-authored
--                     title/headline, raise momentum as %, optional $ amounts
--                     when the owner opts in, min check, Chain-of-Trust %).
--                     Sensitive fund data (thesis, terms, track record, team)
--                     is never selected onto the public path.
-- `raise_interests` : inbound "express interest" leads captured from the public
--                     page. Inserts happen via the service-role admin client on
--                     the public route (mirroring member_profile_shares /
--                     beta_links); authenticated owners/admins can READ their
--                     own org's leads under RLS.
--
-- Every statement is idempotent so the migration is safe to re-apply on the
-- Supabase preview branch. Additive only — no drops of existing objects.
-- =====================================================================

-- ---------- raise_pages ----------
create table if not exists public.raise_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique,
  -- Owner-authored public copy. Title falls back to the org name in the UI.
  title text,
  headline text,
  -- Smallest indicative check the raise will entertain (display-only). Null = unset.
  min_check numeric,
  -- When false (default) the public page shows momentum as percentages only and
  -- hides absolute dollar figures (target / committed / soft-circled).
  show_amounts boolean not null default false,
  -- null = never expires; otherwise the link is dead past this instant.
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite unique so child rows can FK (id, org_id) together — this prevents
  -- a lead from ever being filed under an org that doesn't own the page.
  constraint raise_pages_id_org_id_key unique (id, org_id)
);

create index if not exists raise_pages_org_id_idx on public.raise_pages (org_id);

-- One LIVE raise page per org — enforced at the DB so concurrent mints can't
-- create duplicate active tokens (mirrors member_profile_shares).
create unique index if not exists raise_pages_one_active_per_org_idx
  on public.raise_pages (org_id)
  where revoked_at is null;

drop trigger if exists set_updated_at on public.raise_pages;
create trigger set_updated_at before update on public.raise_pages
  for each row execute function public.set_updated_at();

alter table public.raise_pages enable row level security;

-- Owners/admins manage their own org's raise pages. Public reads do NOT use RLS
-- — they go through the service-role admin client on the public route.
drop policy if exists "owners manage raise pages" on public.raise_pages;
create policy "owners manage raise pages" on public.raise_pages
  for all to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

-- ---------- raise_interests ----------
create table if not exists public.raise_interests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  raise_page_id uuid not null,
  name text not null,
  email text not null,
  -- Indicative amount the prospect signalled. Null = "didn't say".
  indicative_amount numeric,
  note text,
  created_at timestamptz not null default now(),
  -- Composite FK ties the lead to a page AND guarantees org_id matches the page's
  -- owning org. Without this, a bad service-role insert could file a lead under a
  -- different org_id than the page's, and that org's admins (RLS reads on org_id)
  -- could see another org's leads.
  constraint raise_interests_page_org_fkey
    foreign key (raise_page_id, org_id)
    references public.raise_pages (id, org_id) on delete cascade
);

create index if not exists raise_interests_org_id_idx on public.raise_interests (org_id);
create index if not exists raise_interests_raise_page_id_idx
  on public.raise_interests (raise_page_id);

alter table public.raise_interests enable row level security;

-- Owners/admins READ their own org's inbound interest. Writes come from the
-- public route via the service-role admin client (no authenticated insert path),
-- so there is intentionally no insert/update/delete policy here.
drop policy if exists "owners read raise interests" on public.raise_interests;
create policy "owners read raise interests" on public.raise_interests
  for select to authenticated
  using (private.is_org_admin(org_id));
