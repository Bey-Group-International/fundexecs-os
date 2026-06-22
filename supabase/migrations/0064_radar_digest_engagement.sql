-- 0064_radar_digest_engagement.sql
-- The Act-now Radar digest engagement ledger — the *implicit* half of the
-- learning loop. The explicit loop (radar_feedback, 0061) tunes the Radar from
-- accept/dismiss verdicts; the digest (0062) ships the ranked brief. This table
-- captures what operators actually DO with that brief: opening it is a weak
-- positive ("worth a look"), clicking a row is a strong positive ("worth acting
-- on"). lib/radar-learning folds these counts into the same bounded learned
-- weights, so the ranking improves from engagement, not just explicit ratings.
--
-- Rows are written by the unauthenticated tracking endpoint (/api/digest/track),
-- which guards inserts with an HMAC over the link params — so a row can only be
-- created from a digest link this server actually signed.
--
-- Org-scoped, with the same member-read / writer-write RLS as the rest of the
-- sourcing domain (radar_digest 0062, radar_feedback 0061).

create table if not exists public.radar_digest_engagement (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the digest send this engagement is attributed to (radar_digest_log, 0062);
  -- null-tolerant so a log row vanishing never orphans the signal.
  digest_log_id   uuid references public.radar_digest_log (id) on delete cascade,
  -- the radar item the operator engaged with, denormalized for aggregation.
  entity_id       uuid,
  entity_name     text,
  entity_kind     text,
  move_kind       text,
  -- 'opened' = weak positive (saw the brief); 'clicked' = strong positive (took
  -- the move). These map to graded deltas in the learning loop.
  action          text not null check (action in ('opened', 'clicked')),
  occurred_at     timestamptz not null default now()
);

create index if not exists radar_digest_engagement_org_idx
  on public.radar_digest_engagement (organization_id);

-- The learning loop groups by (org, entity_kind, move_kind); index that path.
create index if not exists radar_digest_engagement_org_kind_idx
  on public.radar_digest_engagement (organization_id, entity_kind, move_kind);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.radar_digest_engagement enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists radar_digest_engagement_select on public.radar_digest_engagement;
create policy radar_digest_engagement_select on public.radar_digest_engagement
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists radar_digest_engagement_write on public.radar_digest_engagement;
create policy radar_digest_engagement_write on public.radar_digest_engagement
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
