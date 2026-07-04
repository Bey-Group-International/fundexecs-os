-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS annotations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type   text        NOT NULL CHECK (entity_type IN ('document','envelope','deal','artifact','session')),
  entity_id     uuid        NOT NULL,
  author_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  content       text        NOT NULL,
  position_json jsonb,
  resolved      boolean     NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  resolved_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_id     uuid        REFERENCES annotations(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE annotations IS 'Collaborative inline annotations on any entity (document, envelope, deal, artifact, session).';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN annotations.entity_type IS 'Type of entity being annotated.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN annotations.position_json IS '{page, x_pct, y_pct, selection_text} for positioned annotations on documents.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN annotations.parent_id IS 'Non-null for threaded replies; references root annotation.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

do $$ begin
  ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE INDEX IF NOT EXISTS annotations_org_id_idx            ON annotations(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS annotations_entity_idx            ON annotations(entity_type, entity_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS annotations_author_id_idx         ON annotations(author_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS annotations_resolved_idx          ON annotations(resolved);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS annotations_parent_id_idx         ON annotations(parent_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS annotations_created_at_idx        ON annotations(created_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_annotations" ON annotations;
do $$ begin
  CREATE POLICY "org_members_annotations" ON annotations
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
