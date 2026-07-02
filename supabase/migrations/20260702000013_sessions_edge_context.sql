-- 20260702000011_sessions_edge_context.sql
-- Adds edge_context (jsonb) to the sessions table.
-- Stores the EdgeContextResult produced by the browser-session metadata
-- pipeline (lib/edge-context.ts). Written by POST /api/edge-context on each
-- tab snapshot; read by /api/chat and the task engine planner to inject
-- workflow context into agent prompts. Nullable: sessions without browser
-- context are unaffected.

alter table sessions
  add column if not exists edge_context jsonb default null;

comment on column sessions.edge_context is
  'Serialised EdgeContextResult from the browser tab metadata pipeline. '
  'Keyed by contextHash; expires after 300 s (checked at read time in code).';
