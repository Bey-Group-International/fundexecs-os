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

COMMENT ON TABLE pipeline_stages IS 'Configurable pipeline stage definitions scoped to an org and hub.';
COMMENT ON COLUMN pipeline_stages.hub IS 'Which hub this stage belongs to (e.g. deal_flow, investor_relations).';
COMMENT ON COLUMN pipeline_stages.entry_conditions IS 'JSON rules that must be satisfied before a deal can enter this stage.';
COMMENT ON COLUMN pipeline_stages.exit_criteria IS 'JSON rules that must be satisfied before a deal can leave this stage.';
COMMENT ON COLUMN pipeline_stages.required_artifacts IS 'Document/artifact slugs that must be attached before exit.';
COMMENT ON COLUMN pipeline_stages.auto_actions IS 'Ordered list of actions triggered automatically on stage entry.';
COMMENT ON COLUMN pipeline_stages.order_index IS 'Display / processing order within the hub pipeline.';

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS pipeline_stages_org_id_idx      ON pipeline_stages(org_id);
CREATE INDEX IF NOT EXISTS pipeline_stages_hub_idx         ON pipeline_stages(hub);
CREATE INDEX IF NOT EXISTS pipeline_stages_order_index_idx ON pipeline_stages(order_index);

DROP POLICY IF EXISTS "org_members_pipeline_stages" ON pipeline_stages;
CREATE POLICY "org_members_pipeline_stages" ON pipeline_stages
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;
COMMENT ON COLUMN deals.pipeline_stage_id IS 'Current pipeline stage for this deal; NULL means unassigned.';
CREATE INDEX IF NOT EXISTS deals_pipeline_stage_id_idx ON deals(pipeline_stage_id);;
