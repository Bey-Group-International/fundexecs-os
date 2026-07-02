-- 20260702000006_share_recipient.sql
-- Adds recipient email and GP open-notification flag to data_room_shares.

ALTER TABLE public.data_room_shares
  ADD COLUMN IF NOT EXISTS recipient_email  text,
  ADD COLUMN IF NOT EXISTS notify_on_open   boolean NOT NULL DEFAULT false;

-- Index to efficiently find active shares by recipient (for bulk doc-update notifications).
CREATE INDEX IF NOT EXISTS data_room_shares_recipient_idx
  ON public.data_room_shares (organization_id, recipient_email)
  WHERE recipient_email IS NOT NULL AND revoked_at IS NULL;
