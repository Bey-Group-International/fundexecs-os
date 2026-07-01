-- Migration: Live Annotation & Collaborative Review (Feature 13).
--
-- annotations table supports inline, positioned, and threaded annotations
-- on any entity type with Supabase Realtime for live collaboration.

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

COMMENT ON TABLE annotations IS 'Collaborative inline annotations on any entity (document, envelope, deal, artifact, session).';
COMMENT ON COLUMN annotations.entity_type IS 'Type of entity being annotated.';
COMMENT ON COLUMN annotations.position_json IS '{page, x_pct, y_pct, selection_text} for positioned annotations on documents.';
COMMENT ON COLUMN annotations.parent_id IS 'Non-null for threaded replies; references root annotation.';

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS annotations_org_id_idx    ON annotations(org_id);
CREATE INDEX IF NOT EXISTS annotations_entity_idx    ON annotations(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS annotations_author_id_idx ON annotations(author_id);
CREATE INDEX IF NOT EXISTS annotations_resolved_idx  ON annotations(resolved);
CREATE INDEX IF NOT EXISTS annotations_parent_id_idx ON annotations(parent_id);
CREATE INDEX IF NOT EXISTS annotations_created_at_idx ON annotations(created_at);

DROP POLICY IF EXISTS "org_members_annotations" ON annotations;
CREATE POLICY "org_members_annotations" ON annotations
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
