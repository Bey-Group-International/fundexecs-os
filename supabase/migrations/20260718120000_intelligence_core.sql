-- 20260718120000_intelligence_core.sql
-- The native FundExecs Intelligence Core — provider-neutral canonical schemas.
--
-- FundExecs owns intelligence; a provider (Signal Bureau, or any future source)
-- is an OPTIONAL feed. This migration lands the canonical record layer that was
-- ABSENT: raw observations, the entities we track, the exposures they touch,
-- FundExecs' own assessment of what it means, the watchlists that scope it, and
-- the provider connections that feed it. Nothing here depends on any provider —
-- the tables work with manual entry alone, and a provider merely writes rows
-- through the anti-corruption adapter (lib/intelligence/providers/*).
--
-- House conventions (mirrored exactly): tenancy on organization_id →
-- public.organizations(id); canonical member-read / writer-write RLS via
-- public.current_principal_org_ids() + public.is_org_writer(); updated_at via
-- public.set_updated_at(); idempotent create-if-not-exists + drop-then-create
-- policies so a preview-branch replay is a no-op. Encrypted provider secrets
-- reuse the org_secrets / mcp_servers AES-256-GCM vault envelope (lib/vault.ts):
-- ciphertext + iv + auth_tag (base64) + a masked last-4; the plaintext is never
-- persisted and never returned to the client.

-- ---------------------------------------------------------------------------
-- provider_connections — one row per (org, provider). The ONLY place a provider
-- is configured. FundExecs works with zero rows here (native / manual mode).
-- ---------------------------------------------------------------------------
create table if not exists public.intelligence_provider_connections (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- Stable provider key matching the native registry (lib/intelligence/provider.ts),
  -- e.g. 'signal_bureau'. One connection per provider per org.
  provider          text not null,
  -- Operator-facing label for the connection.
  label             text,
  -- Lifecycle: a paused connection stays configured but is not swept.
  status            text not null default 'disabled'
                      check (status in ('disabled', 'connected', 'error', 'revoked')),
  -- How this connection authenticates: which capability surfaces it may use.
  auth_mode         text not null default 'rest'
                      check (auth_mode in ('none', 'rest', 'mcp')),
  -- Per-connection operating config (base URL, sync cadence, mode toggles,
  -- tracked-concern selectors). Provider-neutral open bag; never holds secrets.
  config            jsonb not null default '{}'::jsonb,
  -- Feature permissions the plan grants (e.g. {"ask": true, "mcp": false}).
  feature_permissions jsonb not null default '{}'::jsonb,
  -- Provider rate-limit disclosure, for the connector's own limiter.
  rate_limits       jsonb not null default '{}'::jsonb,
  -- Health + sync bookkeeping — what integration_connections lacked.
  health            text not null default 'unknown'
                      check (health in ('unknown', 'healthy', 'degraded', 'down')),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  last_error        text,
  -- Encrypted API token (base64 ciphertext + nonce + tag). Null = no auth.
  token_ciphertext  text,
  token_iv          text,
  token_auth_tag    text,
  token_last4       text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, provider)
);

create index if not exists intel_provider_conn_org_idx
  on public.intelligence_provider_connections (organization_id, status);

-- ---------------------------------------------------------------------------
-- tracked_entities — the universe FundExecs monitors. Provider-neutral; an
-- entity may be created manually or matched from an incoming observation.
-- ---------------------------------------------------------------------------
create table if not exists public.tracked_entities (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  entity_type       text not null
                      check (entity_type in (
                        'company', 'fund', 'investor', 'lender', 'sponsor',
                        'individual', 'portfolio_company', 'target_company',
                        'sector', 'geography', 'commodity', 'regulation',
                        'technology', 'macro_event', 'concern')),
  name              text not null,
  aliases           text[] not null default '{}',
  description       text,
  -- Cross-system identifiers (ticker, LEI, CIK, provider ids, internal FKs).
  external_identifiers jsonb not null default '{}'::jsonb,
  status            text not null default 'active'
                      check (status in ('active', 'muted', 'archived')),
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists tracked_entities_org_idx
  on public.tracked_entities (organization_id, entity_type, status);

-- ---------------------------------------------------------------------------
-- intelligence_observations — one raw observation from any provider (or manual).
-- The provider payload is preserved verbatim in raw_payload; dedup is enforced
-- by a per-org deduplication_key.
-- ---------------------------------------------------------------------------
create table if not exists public.intelligence_observations (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- 'native' for manual entry, else a provider key ('signal_bureau').
  provider          text not null default 'native',
  provider_record_id text,
  provider_schema_version text,
  observation_type  text not null default 'signal',
  title             text not null,
  summary           text,
  -- When the underlying event happened (provider observedAt).
  observed_at       timestamptz,
  -- The provider's own as-of stamp — distinct from ingest time. Never conflated.
  provider_as_of    timestamptz,
  ingested_at       timestamptz not null default now(),
  -- Freshness is recomputed against the source TTL at read; stored last verdict.
  freshness_status  text not null default 'fresh'
                      check (freshness_status in ('fresh', 'aging', 'stale')),
  -- Receipted evidence vs an unreceipted lead — NEVER collapsed.
  evidence_status   text not null default 'unreceipted'
                      check (evidence_status in ('receipted', 'corroborated', 'unreceipted', 'unknown')),
  confidence        numeric not null default 0,
  source_urls       text[] not null default '{}',
  -- The provider payload, verbatim (incl. unknown fields), for provenance + replay.
  raw_payload       jsonb not null default '{}'::jsonb,
  -- Stable hash of the normalized content — dedup + change detection.
  content_hash      text not null,
  -- Per-org idempotency key (provider + record id, else content hash).
  deduplication_key text not null,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, deduplication_key)
);

create index if not exists intel_obs_org_observed_idx
  on public.intelligence_observations (organization_id, observed_at desc);
create index if not exists intel_obs_org_provider_idx
  on public.intelligence_observations (organization_id, provider);

-- ---------------------------------------------------------------------------
-- entity_observation_links — an observation touches one or more tracked entities.
-- Records HOW the match was made and by WHOM (provider / inferred / human).
-- ---------------------------------------------------------------------------
create table if not exists public.entity_observation_links (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  observation_id    uuid not null references public.intelligence_observations (id) on delete cascade,
  entity_id         uuid not null references public.tracked_entities (id) on delete cascade,
  match_method      text not null default 'inferred'
                      check (match_method in ('exact', 'alias', 'external_id', 'inferred', 'manual')),
  match_confidence  numeric not null default 0,
  -- The relationship the provider asserted (verbatim label, if any).
  provider_relationship text,
  -- The relationship FundExecs inferred.
  inferred_relationship text,
  -- True once an operator confirmed the link.
  human_confirmed   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (observation_id, entity_id)
);

create index if not exists entity_obs_links_entity_idx
  on public.entity_observation_links (organization_id, entity_id);

-- ---------------------------------------------------------------------------
-- intelligence_exposures — maps an observation/entity to a FundExecs record
-- (fund, mandate, deal, portfolio company, LP, lender, sector, thesis, …).
-- This is the "why does it matter to THIS firm" join.
-- ---------------------------------------------------------------------------
create table if not exists public.intelligence_exposures (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  observation_id    uuid references public.intelligence_observations (id) on delete cascade,
  entity_id         uuid references public.tracked_entities (id) on delete set null,
  exposure_type     text not null
                      check (exposure_type in (
                        'fund', 'mandate', 'deal', 'pipeline_opportunity',
                        'portfolio_company', 'lp', 'capital_provider', 'lender',
                        'vendor', 'geography', 'sector', 'thesis', 'operating_initiative')),
  -- Polymorphic target (a deals/funds/mandates/… row); no FK by design.
  target_type       text,
  target_id         uuid,
  target_name       text,
  exposure_direction text not null default 'neutral'
                      check (exposure_direction in ('positive', 'negative', 'neutral', 'mixed')),
  -- 0–100 rough size of the exposure.
  exposure_magnitude numeric not null default 0,
  -- 0–100 materiality of this exposure specifically.
  materiality       numeric not null default 0,
  rationale         text,
  confirmed_by      uuid references public.principals (id) on delete set null,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists intel_exposure_obs_idx
  on public.intelligence_exposures (organization_id, observation_id);

-- ---------------------------------------------------------------------------
-- intelligence_assessments — FundExecs' OWN interpretation of an observation.
-- Multi-dimensional + explainable: the score_breakdown keeps every dimension
-- visible (never one opaque number). Assigned agent + required tier connect it
-- to the Earn loop and the gate layer.
-- ---------------------------------------------------------------------------
create table if not exists public.intelligence_assessments (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  observation_id    uuid not null references public.intelligence_observations (id) on delete cascade,
  -- Separately visible relevance dimensions (0–100 each).
  mandate_relevance     numeric not null default 0,
  deal_relevance        numeric not null default 0,
  portfolio_relevance   numeric not null default 0,
  relationship_relevance numeric not null default 0,
  regulatory_relevance  numeric not null default 0,
  materiality           numeric not null default 0,
  urgency               numeric not null default 0,
  confidence            numeric not null default 0,
  -- Composite the routing bar reads. Not a replacement for the dimensions.
  actionability         numeric not null default 0,
  potential_impact      text,
  time_horizon          text
                          check (time_horizon in ('immediate', 'near_term', 'medium_term', 'long_term', 'unknown'))
                          default 'unknown',
  -- Scenario implications {bull, base, bear} + what would invalidate this.
  implications          jsonb not null default '{}'::jsonb,
  invalidators          text,
  monitoring_condition  text,
  recommended_action    text,
  -- The specialist Earn should route this to (an agents.ts AgentKey), and the
  -- gate tier the follow-on action requires (lib/gates.ts).
  assigned_agent        text,
  required_tier         integer not null default 1 check (required_tier between 1 and 3),
  -- The exact per-dimension inputs + weights that produced actionability, and
  -- the weights version, so any surfaced item is fully explainable + auditable.
  score_breakdown       jsonb not null default '{}'::jsonb,
  weights_version       text not null default 'v1',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (observation_id)
);

create index if not exists intel_assess_org_action_idx
  on public.intelligence_assessments (organization_id, actionability desc);

-- ---------------------------------------------------------------------------
-- watchlists (+ items) — scope intelligence to the operating model. Scope is
-- polymorphic (workspace / fund / mandate / deal / portfolio / user) so the same
-- table serves every level. The ten-concern private-desk cap is a PROVIDER-PLAN
-- constraint enforced in app logic, NOT hard-coded here.
-- ---------------------------------------------------------------------------
create table if not exists public.watchlists (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  scope_type        text not null default 'workspace'
                      check (scope_type in ('workspace', 'fund', 'mandate', 'deal', 'portfolio', 'user')),
  scope_id          uuid,
  name              text not null,
  description       text,
  -- Materiality threshold, briefing cadence, escalation policy live here.
  config            jsonb not null default '{}'::jsonb,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists watchlists_org_scope_idx
  on public.watchlists (organization_id, scope_type, scope_id);

create table if not exists public.watchlist_items (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  watchlist_id      uuid not null references public.watchlists (id) on delete cascade,
  entity_id         uuid not null references public.tracked_entities (id) on delete cascade,
  -- Per-item override of the watchlist materiality threshold.
  materiality_threshold numeric,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (watchlist_id, entity_id)
);

create index if not exists watchlist_items_wl_idx
  on public.watchlist_items (organization_id, watchlist_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists intel_provider_conn_set_updated_at on public.intelligence_provider_connections;
create trigger intel_provider_conn_set_updated_at
  before update on public.intelligence_provider_connections
  for each row execute function public.set_updated_at();

drop trigger if exists tracked_entities_set_updated_at on public.tracked_entities;
create trigger tracked_entities_set_updated_at
  before update on public.tracked_entities
  for each row execute function public.set_updated_at();

drop trigger if exists intel_obs_set_updated_at on public.intelligence_observations;
create trigger intel_obs_set_updated_at
  before update on public.intelligence_observations
  for each row execute function public.set_updated_at();

drop trigger if exists entity_obs_links_set_updated_at on public.entity_observation_links;
create trigger entity_obs_links_set_updated_at
  before update on public.entity_observation_links
  for each row execute function public.set_updated_at();

drop trigger if exists intel_exposure_set_updated_at on public.intelligence_exposures;
create trigger intel_exposure_set_updated_at
  before update on public.intelligence_exposures
  for each row execute function public.set_updated_at();

drop trigger if exists intel_assess_set_updated_at on public.intelligence_assessments;
create trigger intel_assess_set_updated_at
  before update on public.intelligence_assessments
  for each row execute function public.set_updated_at();

drop trigger if exists watchlists_set_updated_at on public.watchlists;
create trigger watchlists_set_updated_at
  before update on public.watchlists
  for each row execute function public.set_updated_at();

drop trigger if exists watchlist_items_set_updated_at on public.watchlist_items;
create trigger watchlist_items_set_updated_at
  before update on public.watchlist_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — canonical member-read / writer-write org tenancy on every table.
-- ---------------------------------------------------------------------------
alter table public.intelligence_provider_connections enable row level security;
drop policy if exists intel_provider_conn_select on public.intelligence_provider_connections;
create policy intel_provider_conn_select on public.intelligence_provider_connections
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists intel_provider_conn_write on public.intelligence_provider_connections;
create policy intel_provider_conn_write on public.intelligence_provider_connections
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.tracked_entities enable row level security;
drop policy if exists tracked_entities_select on public.tracked_entities;
create policy tracked_entities_select on public.tracked_entities
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists tracked_entities_write on public.tracked_entities;
create policy tracked_entities_write on public.tracked_entities
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.intelligence_observations enable row level security;
drop policy if exists intel_obs_select on public.intelligence_observations;
create policy intel_obs_select on public.intelligence_observations
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists intel_obs_write on public.intelligence_observations;
create policy intel_obs_write on public.intelligence_observations
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.entity_observation_links enable row level security;
drop policy if exists entity_obs_links_select on public.entity_observation_links;
create policy entity_obs_links_select on public.entity_observation_links
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists entity_obs_links_write on public.entity_observation_links;
create policy entity_obs_links_write on public.entity_observation_links
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.intelligence_exposures enable row level security;
drop policy if exists intel_exposure_select on public.intelligence_exposures;
create policy intel_exposure_select on public.intelligence_exposures
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists intel_exposure_write on public.intelligence_exposures;
create policy intel_exposure_write on public.intelligence_exposures
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.intelligence_assessments enable row level security;
drop policy if exists intel_assess_select on public.intelligence_assessments;
create policy intel_assess_select on public.intelligence_assessments
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists intel_assess_write on public.intelligence_assessments;
create policy intel_assess_write on public.intelligence_assessments
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.watchlists enable row level security;
drop policy if exists watchlists_select on public.watchlists;
create policy watchlists_select on public.watchlists
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists watchlists_write on public.watchlists;
create policy watchlists_write on public.watchlists
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

alter table public.watchlist_items enable row level security;
drop policy if exists watchlist_items_select on public.watchlist_items;
create policy watchlist_items_select on public.watchlist_items
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists watchlist_items_write on public.watchlist_items;
create policy watchlist_items_write on public.watchlist_items
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- Realtime — observations + assessments drive the live intelligence surfaces.
-- RLS still filters per subscriber. Idempotent (ignore duplicate-add error).
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.intelligence_observations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.intelligence_assessments;
exception when duplicate_object then null;
end $$;
