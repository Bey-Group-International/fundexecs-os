-- Migration: Visual Automation Canvas (Feature 07).
--
-- Extends automations table with canvas_json for visual workflow builder.
-- Adds workflow_templates for reusable node graph templates.

-- ── automations.canvas_json ───────────────────────────────────────────────────

DO $$
BEGIN
  ALTER TABLE automations ADD COLUMN IF NOT EXISTS canvas_json jsonb;
  COMMENT ON COLUMN automations.canvas_json IS 'ReactFlow-compatible node/edge layout JSON for the visual automation builder.';
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

-- ── workflow_templates ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  description  text,
  canvas_json  jsonb       NOT NULL DEFAULT '{}',
  is_global    boolean     NOT NULL DEFAULT false,
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE workflow_templates IS 'Reusable visual automation canvas templates. Global templates are available to all orgs.';
COMMENT ON COLUMN workflow_templates.is_global IS 'When true, available to all organizations regardless of org_id.';

ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS workflow_templates_org_id_idx   ON workflow_templates(org_id);
CREATE INDEX IF NOT EXISTS workflow_templates_is_global_idx ON workflow_templates(is_global);

DROP POLICY IF EXISTS "org_members_workflow_templates" ON workflow_templates;
CREATE POLICY "org_members_workflow_templates" ON workflow_templates
  FOR ALL USING (
    is_global = true
    OR org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
