-- =====================================================================
-- Reconcile toward the product blueprint + add the AI knowledge base.
-- Extends the existing org-scoped schema (does not rename existing tables).
-- Reuses the private.is_org_member / private.is_org_admin RLS helpers.
-- =====================================================================

create extension if not exists vector with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------
-- Ecosystem directory
-- ---------------------------------------------------------------------
create table public.service_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_providers_org_id_idx on public.service_providers (org_id);

create table public.capital_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  capital_types text[] not null default '{}',
  check_size_min numeric(18, 2),
  check_size_max numeric(18, 2),
  criteria jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index capital_providers_org_id_idx on public.capital_providers (org_id);

-- ---------------------------------------------------------------------
-- 100/30/10 Governance
-- ---------------------------------------------------------------------
create table public.governance_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  name text not null,
  horizon text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index governance_plans_org_id_idx on public.governance_plans (org_id);

create table public.governance_objectives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.governance_plans (id) on delete cascade,
  objective text not null,
  timeline text,
  owner_id uuid references public.profiles (id) on delete set null,
  priority text not null default 'medium',
  ai_recommendation text,
  status text not null default 'open',
  read_at timestamptz,
  archived_at timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index governance_objectives_org_id_idx on public.governance_objectives (org_id);
create index governance_objectives_plan_id_idx on public.governance_objectives (plan_id);

-- ---------------------------------------------------------------------
-- Synergy opportunities (AI-surfaced matches across entities)
-- ---------------------------------------------------------------------
create table public.synergy_opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_entity_type text not null,
  source_entity_id uuid,
  target_entity_type text not null,
  target_entity_id uuid,
  rationale text,
  score numeric(5, 2),
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index synergy_opportunities_org_id_idx on public.synergy_opportunities (org_id);

-- ---------------------------------------------------------------------
-- Chain of Trust — state model (complements the trust_events audit log)
-- ---------------------------------------------------------------------
create table public.chain_of_trust_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  current_layer text not null default 'Proof of Truth',
  completion_percentage numeric(5, 2) not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chain_of_trust_records_org_id_idx on public.chain_of_trust_records (org_id);
create index chain_of_trust_records_entity_idx on public.chain_of_trust_records (entity_type, entity_id);

create table public.proof_layers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  chain_record_id uuid not null references public.chain_of_trust_records (id) on delete cascade,
  layer_name text not null,
  layer_order int not null,
  required_documents jsonb not null default '[]'::jsonb,
  required_tasks jsonb not null default '[]'::jsonb,
  ai_validation_notes text,
  human_approval_status text not null default 'pending',
  completion_percentage numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index proof_layers_chain_record_id_idx on public.proof_layers (chain_record_id);
create index proof_layers_org_id_idx on public.proof_layers (org_id);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  proof_layer_id uuid not null references public.proof_layers (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  evidence_type text,
  notes text,
  created_at timestamptz not null default now()
);
create index evidence_proof_layer_id_idx on public.evidence (proof_layer_id);
create index evidence_org_id_idx on public.evidence (org_id);

-- ---------------------------------------------------------------------
-- Admin actions audit (Bey Group Admin Portal)
-- ---------------------------------------------------------------------
create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  admin_user_id uuid references public.profiles (id) on delete set null,
  action_type text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_actions_org_id_idx on public.admin_actions (org_id);

-- ---------------------------------------------------------------------
-- AI knowledge base (the 15 "Earn" brains) — pgvector RAG
-- org_id NULL = a global BGI brain shared across all orgs.
-- ---------------------------------------------------------------------
create table public.ai_brains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  persona text,
  is_global boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ai_brains_org_slug_idx on public.ai_brains (coalesce(org_id, '00000000-0000-0000-0000-000000000000'), slug);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  brain_id uuid not null references public.ai_brains (id) on delete cascade,
  title text not null,
  source text,
  uri text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_documents_brain_id_idx on public.knowledge_documents (brain_id);
create index knowledge_documents_org_id_idx on public.knowledge_documents (org_id);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  brain_id uuid not null references public.ai_brains (id) on delete cascade,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  chunk_index int not null default 0,
  content text not null,
  token_count int,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);
create index knowledge_chunks_document_id_idx on public.knowledge_chunks (document_id);
create index knowledge_chunks_org_id_idx on public.knowledge_chunks (org_id);
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table public.brain_routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  brain_id uuid not null references public.ai_brains (id) on delete cascade,
  pattern text not null,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index brain_routing_rules_brain_id_idx on public.brain_routing_rules (brain_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create trigger set_updated_at before update on public.service_providers for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.capital_providers for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.governance_plans for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.governance_objectives for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.synergy_opportunities for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.chain_of_trust_records for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.proof_layers for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.ai_brains for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.knowledge_documents for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RAG search RPC (org-scoped + global brains; SECURITY DEFINER)
-- ---------------------------------------------------------------------
create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 8,
  _org_id uuid default null
)
returns table (id uuid, document_id uuid, brain_id uuid, content text, similarity double precision)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.document_id, c.brain_id, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks c
  where c.embedding is not null
    and (c.org_id is null or private.is_org_member(c.org_id))
    and (_org_id is null or c.org_id is null or c.org_id = _org_id)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
revoke all on function public.match_knowledge_chunks(extensions.vector, int, uuid) from public, anon;
grant execute on function public.match_knowledge_chunks(extensions.vector, int, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table public.service_providers enable row level security;
alter table public.capital_providers enable row level security;
alter table public.governance_plans enable row level security;
alter table public.governance_objectives enable row level security;
alter table public.synergy_opportunities enable row level security;
alter table public.chain_of_trust_records enable row level security;
alter table public.proof_layers enable row level security;
alter table public.evidence enable row level security;
alter table public.admin_actions enable row level security;
alter table public.ai_brains enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.brain_routing_rules enable row level security;

-- ---------------------------------------------------------------------
-- Policies — standard org-scoped CRUD (members read/write, admins delete)
-- ---------------------------------------------------------------------
-- service_providers
create policy "members read service_providers" on public.service_providers for select to authenticated using (private.is_org_member(org_id));
create policy "members write service_providers" on public.service_providers for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update service_providers" on public.service_providers for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete service_providers" on public.service_providers for delete to authenticated using (private.is_org_admin(org_id));

-- capital_providers
create policy "members read capital_providers" on public.capital_providers for select to authenticated using (private.is_org_member(org_id));
create policy "members write capital_providers" on public.capital_providers for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update capital_providers" on public.capital_providers for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete capital_providers" on public.capital_providers for delete to authenticated using (private.is_org_admin(org_id));

-- governance_plans
create policy "members read governance_plans" on public.governance_plans for select to authenticated using (private.is_org_member(org_id));
create policy "members write governance_plans" on public.governance_plans for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update governance_plans" on public.governance_plans for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete governance_plans" on public.governance_plans for delete to authenticated using (private.is_org_admin(org_id));

-- governance_objectives
create policy "members read governance_objectives" on public.governance_objectives for select to authenticated using (private.is_org_member(org_id));
create policy "members write governance_objectives" on public.governance_objectives for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update governance_objectives" on public.governance_objectives for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete governance_objectives" on public.governance_objectives for delete to authenticated using (private.is_org_admin(org_id));

-- synergy_opportunities
create policy "members read synergy_opportunities" on public.synergy_opportunities for select to authenticated using (private.is_org_member(org_id));
create policy "members write synergy_opportunities" on public.synergy_opportunities for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update synergy_opportunities" on public.synergy_opportunities for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete synergy_opportunities" on public.synergy_opportunities for delete to authenticated using (private.is_org_admin(org_id));

-- chain_of_trust_records
create policy "members read chain_of_trust_records" on public.chain_of_trust_records for select to authenticated using (private.is_org_member(org_id));
create policy "members write chain_of_trust_records" on public.chain_of_trust_records for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update chain_of_trust_records" on public.chain_of_trust_records for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete chain_of_trust_records" on public.chain_of_trust_records for delete to authenticated using (private.is_org_admin(org_id));

-- proof_layers
create policy "members read proof_layers" on public.proof_layers for select to authenticated using (private.is_org_member(org_id));
create policy "members write proof_layers" on public.proof_layers for insert to authenticated with check (private.is_org_member(org_id));
create policy "members update proof_layers" on public.proof_layers for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "admins delete proof_layers" on public.proof_layers for delete to authenticated using (private.is_org_admin(org_id));

-- evidence
create policy "members read evidence" on public.evidence for select to authenticated using (private.is_org_member(org_id));
create policy "members write evidence" on public.evidence for insert to authenticated with check (private.is_org_member(org_id));
create policy "admins delete evidence" on public.evidence for delete to authenticated using (private.is_org_admin(org_id));

-- admin_actions (org admins only; append-only)
create policy "admins read admin_actions" on public.admin_actions for select to authenticated using (org_id is not null and private.is_org_admin(org_id));
create policy "admins append admin_actions" on public.admin_actions for insert to authenticated with check (org_id is not null and private.is_org_admin(org_id));

-- ai_brains (global brains readable by all authenticated; org brains by members)
create policy "read brains" on public.ai_brains for select to authenticated using (org_id is null or private.is_org_member(org_id));
create policy "org admins write brains" on public.ai_brains for insert to authenticated with check (org_id is not null and private.is_org_admin(org_id));
create policy "org admins update brains" on public.ai_brains for update to authenticated using (org_id is not null and private.is_org_admin(org_id)) with check (org_id is not null and private.is_org_admin(org_id));
create policy "org admins delete brains" on public.ai_brains for delete to authenticated using (org_id is not null and private.is_org_admin(org_id));

-- knowledge_documents
create policy "read knowledge_documents" on public.knowledge_documents for select to authenticated using (org_id is null or private.is_org_member(org_id));
create policy "org members write knowledge_documents" on public.knowledge_documents for insert to authenticated with check (org_id is not null and private.is_org_member(org_id));
create policy "org members update knowledge_documents" on public.knowledge_documents for update to authenticated using (org_id is not null and private.is_org_member(org_id)) with check (org_id is not null and private.is_org_member(org_id));
create policy "org admins delete knowledge_documents" on public.knowledge_documents for delete to authenticated using (org_id is not null and private.is_org_admin(org_id));

-- knowledge_chunks
create policy "read knowledge_chunks" on public.knowledge_chunks for select to authenticated using (org_id is null or private.is_org_member(org_id));
create policy "org members write knowledge_chunks" on public.knowledge_chunks for insert to authenticated with check (org_id is not null and private.is_org_member(org_id));
create policy "org members update knowledge_chunks" on public.knowledge_chunks for update to authenticated using (org_id is not null and private.is_org_member(org_id)) with check (org_id is not null and private.is_org_member(org_id));
create policy "org admins delete knowledge_chunks" on public.knowledge_chunks for delete to authenticated using (org_id is not null and private.is_org_admin(org_id));

-- brain_routing_rules
create policy "read brain_routing_rules" on public.brain_routing_rules for select to authenticated using (org_id is null or private.is_org_member(org_id));
create policy "org admins manage brain_routing_rules" on public.brain_routing_rules for all to authenticated using (org_id is not null and private.is_org_admin(org_id)) with check (org_id is not null and private.is_org_admin(org_id));
