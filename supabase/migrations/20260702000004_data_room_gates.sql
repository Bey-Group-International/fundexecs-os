-- 20260702000003_data_room_gates.sql
-- Phase 1: Access-control gates on data_room_shares (email, NDA, password).
-- Phase 2: Engagement fields on data_room_views (viewer email, dwell time, session).

-- ---------------------------------------------------------------------------
-- data_room_shares — gate columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_room_shares
  ADD COLUMN IF NOT EXISTS require_email  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_nda    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nda_text       text,
  ADD COLUMN IF NOT EXISTS password_hash  text;

-- ---------------------------------------------------------------------------
-- data_room_views — engagement columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_room_views
  ADD COLUMN IF NOT EXISTS viewer_email     text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS session_id       text;

-- Index for analytics queries (per-share viewer rollups)
CREATE INDEX IF NOT EXISTS data_room_views_share_idx
  ON public.data_room_views (share_id, created_at DESC);
