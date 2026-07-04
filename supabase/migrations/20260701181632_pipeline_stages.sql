-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hub                 text        NOT NULL,
  name                text        NOT NULL,
  entry_conditions    jsonb       NOT NULL DEFAULT '{}',
  exit_criteria       jsonb       NOT NULL DEFAULT '{}',
  required_artifacts  text[]      NOT NULL DEFAULT '{}',
  auto_actions        jsonb       NOT NULL DEFAULT '[]',
  order_index         int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE pipeline_stages IS 'Configurable pipeline stage definitions scoped to an org and hub.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN pipeline_stages.hub IS 'Which hub this stage belongs to (e.g. deal_flow, investor_relations).';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN pipeline_stages.entry_conditions IS 'JSON rules that must be satisfied before a deal can enter this stage.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN pipeline_stages.exit_criteria IS 'JSON rules that must be satisfied before a deal can leave this stage.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN pipeline_stages.required_artifacts IS 'Document/artifact slugs that must be attached before exit.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN pipeline_stages.auto_actions IS 'Ordered list of actions triggered automatically on stage entry.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN pipeline_stages.order_index IS 'Display / processing order within the hub pipeline.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS pipeline_stages_org_id_idx      ON pipeline_stages(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS pipeline_stages_hub_idx         ON pipeline_stages(hub);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS pipeline_stages_order_index_idx ON pipeline_stages(order_index);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_pipeline_stages" ON pipeline_stages;
CREATE POLICY "org_members_pipeline_stages" ON pipeline_stages
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;
do $$ begin
  COMMENT ON COLUMN deals.pipeline_stage_id IS 'Current pipeline stage for this deal;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$; NULL means unassigned.';
do $$ begin
  CREATE INDEX IF NOT EXISTS deals_pipeline_stage_id_idx ON deals(pipeline_stage_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;;
