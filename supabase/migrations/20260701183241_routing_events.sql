-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS routing_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid        REFERENCES tasks(id) ON DELETE CASCADE,
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key     text        NOT NULL,
  step_index    int,
  rationale_json jsonb,
  confidence    float       CHECK (confidence >= 0 AND confidence <= 1),
  created_at    timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE routing_events IS 'Immutable log of agent routing decisions — which agent was assigned to each step and why.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN routing_events.confidence IS 'Routing confidence 0-1. Events below 0.7 are flagged for operator review.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE routing_events ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS routing_events_task_id_idx    ON routing_events(task_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS routing_events_org_id_idx     ON routing_events(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS routing_events_created_at_idx ON routing_events(created_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_routing_events" ON routing_events;
CREATE POLICY "org_members_routing_events" ON routing_events
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );;
