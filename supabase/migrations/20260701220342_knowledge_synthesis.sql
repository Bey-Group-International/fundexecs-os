-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS synthesis_queue (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  topic_key           text        NOT NULL,
  source_artifact_ids jsonb       NOT NULL DEFAULT '[]',
  synthesis_status    text        NOT NULL DEFAULT 'pending'
                      CHECK (synthesis_status IN ('pending','processing','approved','discarded')),
  draft_content       text,
  approved_at         timestamptz,
  approved_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, topic_key)
);

do $$ begin
  COMMENT ON TABLE synthesis_queue IS 'Pending and approved knowledge synthesis jobs — groups artifacts by topic and triggers Claude synthesis on threshold.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN synthesis_queue.topic_key IS 'Namespaced topic identifier, e.g. "deal:uuid", "investor:uuid", "sector:fintech".';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN synthesis_queue.source_artifact_ids IS 'JSON array of artifact IDs that feed this synthesis.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN synthesis_queue.synthesis_status IS 'pending → processing → approved | discarded.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE synthesis_queue ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS synthesis_queue_org_id_idx          ON synthesis_queue(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS synthesis_queue_topic_key_idx       ON synthesis_queue(topic_key);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS synthesis_queue_synthesis_status_idx ON synthesis_queue(synthesis_status);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS synthesis_queue_created_at_idx      ON synthesis_queue(created_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_synthesis_queue" ON synthesis_queue;
CREATE POLICY "org_members_synthesis_queue" ON synthesis_queue
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );;
