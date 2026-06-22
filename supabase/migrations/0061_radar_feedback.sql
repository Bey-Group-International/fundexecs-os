-- 0061_radar_feedback.sql
-- Radar Learning Loop — the compounding feedback layer on top of the Source Radar
-- (lib/source-radar.ts). The radar fuses the catalog (who), signals + propensity
-- (why now), and mandate fit (why us) into one ranked "act now" list, routing each
-- target into the cluster that acts on it. Today that ranking is static.
--
-- This table captures the operator's verdict on each recommendation — accepted,
-- dismissed, or snoozed — keyed by the (entity_kind, move_kind) combination it was
-- shown for. lib/radar-learning.ts aggregates these into a bounded, explainable
-- adjustment that nudges the score up for move/kind combos the operator keeps
-- acting on and down for ones they keep dismissing. The more the radar is used,
-- the smarter it gets — without ever changing the pure base score.
--
-- `entity_id` links to the sourcing_entities catalog row (0042) when known, but is
-- nullable (a recommendation can target an unlinked subject); we keep entity_name
-- + entity_kind on the row so feedback is self-describing and aggregatable even if
-- the entity later disappears.
--
-- Org-scoped, append-style, with the SAME member-read / writer-write RLS as the
-- sourcing tables it learns from (entity_signals 0055, ownership_intel 0056,
-- outreach_sequences 0060). Fully idempotent so a preview-branch replay is a no-op.

create table if not exists public.radar_feedback (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the catalog row this recommendation was about, when known (nullable + set null
  -- so feedback survives a removed entity).
  entity_id       uuid references public.sourcing_entities (id) on delete set null,
  -- self-describing subject so an aggregate reads even without a linked entity.
  entity_name     text,
  -- the entity kind the recommendation was shown for:
  -- 'company' | 'investor' | 'fund' | 'advisor' | 'lender' | 'provider'.
  entity_kind     text,
  -- the recommended move kind (RadarMoveKind):
  -- 'pipeline' | 'buyers' | 'outreach' | 'signals' | 'research'.
  move_kind       text,
  -- the operator's verdict on the recommendation.
  action          text check (action in ('accepted','dismissed','snoozed')),
  -- the composite radar score the row carried when the operator acted (for audit
  -- + future weighting; the learning layer reads counts, not this directly).
  score_at_action integer,
  principal_id    uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists radar_feedback_org_idx
  on public.radar_feedback (organization_id);
create index if not exists radar_feedback_org_kind_move_idx
  on public.radar_feedback (organization_id, entity_kind, move_kind);

-- RLS: same member-read / writer-write org tenancy as the rest of the sourcing
-- domain (entity_signals 0055, ownership_intel 0056, outreach_sequences 0060).
alter table public.radar_feedback enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists radar_feedback_select on public.radar_feedback;
create policy radar_feedback_select on public.radar_feedback
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists radar_feedback_write on public.radar_feedback;
create policy radar_feedback_write on public.radar_feedback
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
