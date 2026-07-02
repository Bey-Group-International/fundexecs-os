-- Migration: 20260702000003_viewer_access_analytics
-- Extends data_room_shares with access-control gates and
-- data_room_views with viewer identity + dwell-time tracking.

-- Extend share links with access-control gates
ALTER TABLE data_room_shares
  ADD COLUMN IF NOT EXISTS require_email  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_nda    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nda_text       text,
  ADD COLUMN IF NOT EXISTS password_hash  text;

-- Extend view tracking with viewer identity + dwell time
ALTER TABLE data_room_views
  ADD COLUMN IF NOT EXISTS viewer_email     text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS session_id       text;
