-- Deal submissions: public inbound form (no auth required)
create table if not exists public.deal_submissions (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  website       text,
  stage         text not null, -- pre-seed | seed | series-a | series-b+
  raise_amount  numeric,       -- USD
  deck_url      text,
  description   text,
  founder_name  text not null,
  founder_email text not null,
  status        text not null default 'pending', -- pending | reviewed | accepted | declined
  created_at    timestamptz not null default now()
);

-- Public raises: marks a deal as publicly shareable with a vanity slug
alter table public.deals
  add column if not exists public_slug      text unique,
  add column if not exists public_visible   boolean not null default false,
  add column if not exists raise_summary    text,      -- short pitch for the public page
  add column if not exists target_amount    numeric,   -- total raise target USD
  add column if not exists committed_amount numeric default 0,
  add column if not exists close_date       date,
  add column if not exists deck_url         text,
  add column if not exists founder_name     text,
  add column if not exists company_website  text;

-- LP interest captures: anonymous interest on a public raise (separate from existing raise_interests)
create table if not exists public.deal_interest_captures (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals(id) on delete cascade,
  name         text not null,
  email        text not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- RLS: deal_submissions is insert-only for anon, admins read via service role
alter table public.deal_submissions enable row level security;
create policy "anon_insert_deal_submissions"
  on public.deal_submissions for insert
  to anon with check (true);

-- RLS: deal_interest_captures insert-only for anon
alter table public.deal_interest_captures enable row level security;
create policy "anon_insert_deal_interest_captures"
  on public.deal_interest_captures for insert
  to anon with check (true);

-- Public read for visible raise deals (no auth needed)
create policy "public_read_visible_raises"
  on public.deals for select
  to anon
  using (public_visible = true);
