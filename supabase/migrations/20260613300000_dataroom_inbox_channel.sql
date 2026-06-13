-- Add 'dataroom' to the inbox_items channel check constraint.
-- Data room view signals surface as high-priority inbox items (inbound, public_surface).
ALTER TABLE public.inbox_items DROP CONSTRAINT IF EXISTS inbox_items_channel_check;

ALTER TABLE public.inbox_items
  ADD CONSTRAINT inbox_items_channel_check
  CHECK (channel IN ('email', 'slack', 'call', 'linkedin', 'sms', 'webinar', 'dataroom'));
