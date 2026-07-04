-- 20260703250000_api_key_scopes.sql
-- Scoped API keys (integration blueprint, plug-in architecture): an issued key
-- used to be an all-or-nothing org-wide read credential — a leaked key exposed
-- every investor record with no blast-radius control. Keys now carry an
-- explicit scope list enforced per route in withApiKey (lib/api-v1.ts).
--
-- The column default is the full current read set, so every existing key (and
-- any insert that predates the scope picker) keeps exactly the access it had —
-- narrowing is opt-in at issue time, not a silent break.
alter table public.api_keys
  add column if not exists scopes text[] not null
    default '{read:organization,read:deals,read:investors,read:funds}';
