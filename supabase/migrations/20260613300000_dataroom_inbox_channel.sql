-- Add 'dataroom' to the inbox_items channel check constraint.
-- Data room view signals surface as high-priority inbox items (inbound, public_surface).
DO $$
DECLARE
  v_constraint text;
BEGIN
  -- Find the channel check constraint by name pattern
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE rel.relname = 'inbox_items'
    AND ns.nspname = 'public'
    AND con.contype = 'c'
    AND con.conname ILIKE '%channel%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.inbox_items DROP CONSTRAINT %I', v_constraint);
  END IF;

  ALTER TABLE public.inbox_items
    ADD CONSTRAINT inbox_items_channel_check
    CHECK (channel IN ('email', 'slack', 'call', 'linkedin', 'sms', 'webinar', 'dataroom'));
END $$;
