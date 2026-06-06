-- Earn Diligence Intelligence Layer: doc-upload diligence + 7-agent findings.
-- Additive + idempotent. Mirrors knowledge_chunks embedding pattern + org RLS.

create table if not exists public.diligence_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  title text,
  status text not null default 'queued' check (status in ('queued','running','complete','error')),
  conviction int check (conviction between 0 and 100),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diligence_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.diligence_runs (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text,
  kind text not null default 'other' check (kind in ('deck','cim','ppm','ddq','financials','notes','other')),
  created_at timestamptz not null default now()
);

create table if not exists public.diligence_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.diligence_runs (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent text not null check (agent in ('market_size','competitive','customer_demand','unit_economics','stress_test','red_flags','synthesis')),
  score int check (score between 0 and 100),
  summary text not null,
  detail text,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, agent)
);

create table if not exists public.diligence_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.diligence_documents (id) on delete cascade,
  run_id uuid not null references public.diligence_runs (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  chunk_index int not null default 0,
  content text not null,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now()
);

create index if not exists diligence_runs_org_id_idx on public.diligence_runs (org_id);
create index if not exists diligence_runs_deal_id_idx on public.diligence_runs (deal_id);
create index if not exists diligence_documents_run_id_idx on public.diligence_documents (run_id);
create index if not exists diligence_documents_org_id_idx on public.diligence_documents (org_id);
create index if not exists diligence_findings_run_id_idx on public.diligence_findings (run_id);
create index if not exists diligence_findings_org_id_idx on public.diligence_findings (org_id);
create index if not exists diligence_chunks_document_id_idx on public.diligence_chunks (document_id);
create index if not exists diligence_chunks_run_id_idx on public.diligence_chunks (run_id);
create index if not exists diligence_chunks_org_id_idx on public.diligence_chunks (org_id);
create index if not exists diligence_chunks_embedding_idx
  on public.diligence_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.diligence_runs enable row level security;
alter table public.diligence_documents enable row level security;
alter table public.diligence_findings enable row level security;
alter table public.diligence_chunks enable row level security;

-- Members of the org may READ; all writes go through the service-role
-- orchestrator (which bypasses RLS), mirroring the integration-secrets pattern.
drop policy if exists "read diligence_runs" on public.diligence_runs;
create policy "read diligence_runs" on public.diligence_runs
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists "read diligence_documents" on public.diligence_documents;
create policy "read diligence_documents" on public.diligence_documents
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists "read diligence_findings" on public.diligence_findings;
create policy "read diligence_findings" on public.diligence_findings
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists "read diligence_chunks" on public.diligence_chunks;
create policy "read diligence_chunks" on public.diligence_chunks
  for select to authenticated using (private.is_org_member(org_id));

-- Retrieval RPC for the orchestrator (service_role only): cosine match scoped
-- to a single run. Mirrors public.match_knowledge_chunks.
create or replace function public.match_diligence_chunks(
  _run_id uuid,
  query_embedding extensions.vector(1024),
  match_count int default 8
)
returns table (id uuid, document_id uuid, content text, similarity double precision)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.document_id, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.diligence_chunks c
  where c.run_id = _run_id and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
revoke all on function public.match_diligence_chunks(uuid, extensions.vector, int) from public, anon, authenticated;
grant execute on function public.match_diligence_chunks(uuid, extensions.vector, int) to service_role;

-- Private storage bucket for uploaded diligence documents (service-role access;
-- no public access). Path convention: diligence/{org_id}/{run_id}/{file}.
insert into storage.buckets (id, name, public)
values ('diligence', 'diligence', false)
on conflict (id) do nothing;
