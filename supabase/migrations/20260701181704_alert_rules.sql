-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS alert_rules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  trigger_entity   text        NOT NULL,
  trigger_field    text        NOT NULL,
  operator         text        NOT NULL CHECK (operator IN ('lt','gt','eq','changed','contains')),
  threshold_value  text,
  channel          jsonb       NOT NULL DEFAULT '{}',
  escalation       jsonb       NOT NULL DEFAULT '{}',
  active           boolean     NOT NULL DEFAULT true,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE alert_rules IS 'Operator-configured threshold and change alert rules evaluated by cron sweep.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_rules.trigger_entity IS 'Entity type to monitor (e.g. deal, investor, commitment).';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_rules.trigger_field IS 'Field on the entity to evaluate (e.g. conviction_score, status).';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_rules.operator IS 'Comparison: lt | gt | eq | changed | contains.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_rules.threshold_value IS 'Value to compare against; null for "changed" operator.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_rules.channel IS '{slack: bool, email: bool, in_app: bool} delivery channels.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_rules.escalation IS '{hours: int, notify_role: string} escalation config if unacknowledged.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

do $$ begin
  ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE INDEX IF NOT EXISTS alert_rules_org_id_idx ON alert_rules(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS alert_rules_active_idx ON alert_rules(active);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_alert_rules" ON alert_rules;
do $$ begin
  CREATE POLICY "org_members_alert_rules" ON alert_rules
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

CREATE TABLE IF NOT EXISTS alert_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id           uuid        NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  org_id            uuid        NOT NULL,
  entity_type       text        NOT NULL,
  entity_id         uuid,
  payload           jsonb,
  acknowledged_at   timestamptz,
  acknowledged_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE alert_events IS 'Immutable log of fired alert rule evaluations, with acknowledgement tracking.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_events.payload IS 'Snapshot of the triggering values at fire time.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN alert_events.acknowledged_at IS 'When an operator dismissed this alert; null = unacknowledged.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

do $$ begin
  ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE INDEX IF NOT EXISTS alert_events_rule_id_idx         ON alert_events(rule_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS alert_events_org_id_idx          ON alert_events(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS alert_events_acknowledged_at_idx ON alert_events(acknowledged_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS alert_events_created_at_idx      ON alert_events(created_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_alert_events" ON alert_events;
do $$ begin
  CREATE POLICY "org_members_alert_events" ON alert_events
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
