-- Performance: add covering indexes for unindexed foreign keys on the beta
-- invite/links surface, which got hotter now that org owners/admins manage and
-- mint invites for their own workspace (not just the Bey Group team).
--
-- An unindexed FK forces a sequential scan to resolve joins and to check
-- referential integrity on parent deletes. These are all single-column FKs
-- pointing at auth users / beta_links. (org_id on each table is already
-- indexed, so it is not repeated here.) IF NOT EXISTS keeps this idempotent.
--
-- The linter flags the same pattern on several other domains (diligence, raise,
-- referrals, capital_account_entries). Those are intentionally left for the
-- owning teams to triage rather than blanket-indexing every FK in one pass.

create index if not exists idx_beta_invites_invited_by
  on public.beta_invites (invited_by);

create index if not exists idx_beta_link_claims_reviewed_by
  on public.beta_link_claims (reviewed_by);

create index if not exists idx_beta_link_claims_user_id
  on public.beta_link_claims (user_id);

create index if not exists idx_beta_links_created_by
  on public.beta_links (created_by);
