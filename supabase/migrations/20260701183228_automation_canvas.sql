-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
DO $$
BEGIN
  ALTER TABLE automations ADD COLUMN IF NOT EXISTS canvas_json jsonb;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

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

do $$ begin
  COMMENT ON TABLE workflow_templates IS 'Reusable visual automation canvas templates. Global templates are available to all orgs.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

do $$ begin
  ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE INDEX IF NOT EXISTS workflow_templates_org_id_idx    ON workflow_templates(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS workflow_templates_is_global_idx ON workflow_templates(is_global);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_workflow_templates" ON workflow_templates;
do $$ begin
  CREATE POLICY "org_members_workflow_templates" ON workflow_templates
  FOR ALL USING (
    is_global = true
    OR org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
