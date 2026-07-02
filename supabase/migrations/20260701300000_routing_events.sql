-- Migration: Agent Routing Console, Structured Handoff, Task Decomposition (Features 01-03).
--
-- Tables:
--   routing_events — records which agent handled each step and why
--
-- Extends task_steps (if it exists):
--   agent_override  — operator-assigned agent override
--   handoff_packet  — structured context packet between agents
--   depends_on      — DAG dependency array for task decomposition

-- ── routing_events ────────────────────────────────────────────────────────────

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

COMMENT ON TABLE routing_events IS 'Immutable log of agent routing decisions — which agent was assigned to each step and why.';
COMMENT ON COLUMN routing_events.agent_key IS 'Logical agent key (e.g. deal-coach, analyst, diligence).';
COMMENT ON COLUMN routing_events.rationale_json IS 'Structured rationale: prompt fragment, fallback chain, scoring signals.';
COMMENT ON COLUMN routing_events.confidence IS 'Routing confidence 0-1. Events below 0.7 are flagged for operator review.';

ALTER TABLE routing_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS routing_events_task_id_idx    ON routing_events(task_id);
CREATE INDEX IF NOT EXISTS routing_events_org_id_idx     ON routing_events(org_id);
CREATE INDEX IF NOT EXISTS routing_events_created_at_idx ON routing_events(created_at);

DROP POLICY IF EXISTS "org_members_routing_events" ON routing_events;
CREATE POLICY "org_members_routing_events" ON routing_events
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

-- Note: task_steps extensions (agent_override, handoff_packet, depends_on)
-- will be added in a future migration once the task_steps table is created.
