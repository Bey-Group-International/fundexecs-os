-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_memories (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key         text        NOT NULL,
  memory_type       text        NOT NULL
                    CHECK (memory_type IN ('decision','constraint','preference','outcome','open_item')),
  content           text        NOT NULL,
  embedding         vector(1536),
  source_task_id    uuid        REFERENCES tasks(id) ON DELETE SET NULL,
  source_session_id uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  pinned            boolean     NOT NULL DEFAULT false,
  dismissed         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE  agent_memories                   IS 'Persistent cross-session agent memory: decisions, constraints, preferences, outcomes, and open items.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.agent_key         IS 'Logical agent identifier (e.g. "deal-coach", "meeting-copilot"). Scopes memory retrieval.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.memory_type       IS 'Semantic category: decision | constraint | preference | outcome | open_item.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.embedding         IS 'pgvector(1536) embedding for semantic similarity search.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.source_task_id    IS 'Task that produced this memory, if any.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.source_session_id IS 'Session in which this memory was captured, if any.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.pinned            IS 'User-pinned memories are always surfaced regardless of relevance score.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  COMMENT ON COLUMN agent_memories.dismissed         IS 'User-dismissed memories are hidden from default views.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS agent_memories_org_id_idx            ON agent_memories(org_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS agent_memories_agent_key_idx         ON agent_memories(agent_key);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS agent_memories_memory_type_idx       ON agent_memories(memory_type);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS agent_memories_source_task_id_idx    ON agent_memories(source_task_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS agent_memories_source_session_id_idx ON agent_memories(source_session_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS agent_memories_created_at_idx        ON agent_memories(created_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_agent_memories" ON agent_memories;
CREATE POLICY "org_members_agent_memories" ON agent_memories
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS memory_card jsonb NOT NULL DEFAULT '{}';
do $$ begin
  COMMENT ON COLUMN sessions.memory_card IS 'Per-session structured memory summary card (entities, decisions, open questions, constraints). Updated live as the session progresses.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;;
