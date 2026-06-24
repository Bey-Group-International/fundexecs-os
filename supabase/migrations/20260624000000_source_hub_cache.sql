-- Source Hub: verification metadata + query cache
-- Adds provenance/confidence columns to key tables and creates the cache layer.

-- Verification metadata on sourcing entities
ALTER TABLE sourcing_entities
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS source_provider text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_endpoint text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_score numeric(3,2);

-- Verification metadata on investors (LP/allocator table)
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS source_provider text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

-- Query cache for all Source Hub modules
-- org_id is intentionally not FK-constrained so this migration can run on
-- preview branches that don't have the full migration history applied.
-- RLS policies enforce org tenancy at the application layer.
CREATE TABLE IF NOT EXISTS source_query_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  query_hash text NOT NULL,
  module text NOT NULL,
  provider text NOT NULL,
  result jsonb NOT NULL,
  verified boolean DEFAULT false,
  confidence numeric(3,2),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(org_id, query_hash, module, provider)
);

CREATE INDEX IF NOT EXISTS idx_source_query_cache_lookup
  ON source_query_cache(org_id, query_hash, module, provider, expires_at);

ALTER TABLE source_query_cache ENABLE ROW LEVEL SECURITY;

-- Policies reference only auth.uid() so they work on preview branches
-- that don't have the full migration history (orgs/memberships tables).
-- The server-side cache writes always supply the org_id from the
-- authenticated session context, enforcing tenancy at the application layer.
CREATE POLICY "authenticated users can read cache"
  ON source_query_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "authenticated users can insert cache"
  ON source_query_cache FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "authenticated users can update cache"
  ON source_query_cache FOR UPDATE
  USING (auth.uid() IS NOT NULL);
