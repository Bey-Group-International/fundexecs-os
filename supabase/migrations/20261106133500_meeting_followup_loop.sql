-- 20261106133500_meeting_followup_loop.sql
-- The follow-up as a loop rather than a button: who it went to and when, what
-- is scheduled, who has been nudged, the firm's templates, and which action
-- items have been chased.
--
--   live_meeting_followup_sends  one row per recipient per send: scheduled,
--                                sent, failed or cancelled, with the error, the
--                                nudge setting and whether a nudge went out.
--                                The panel's delivery list and the hourly sweep
--                                (scheduled sends, nudges) both read it.
--   followup_templates           a firm's saved follow-up emails.
--   team_tasks.chased_at /       when an overdue action item from a meeting was
--   team_tasks.chase_count       last chased, and how many times, so the sweep
--                                reminds its owner a bounded number of times.
--
-- The routes and the sweep write with the service role after authorising the
-- caller; the policies below are the floor for any direct read.

CREATE TABLE IF NOT EXISTS live_meeting_followup_sends (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  email            text        NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  name             text,
  subject          text        NOT NULL,
  body             text        NOT NULL CHECK (length(body) <= 40000),
  status           text        NOT NULL CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  scheduled_for    timestamptz,
  sent_at          timestamptz,
  error            text,
  nudge_after_days integer     CHECK (nudge_after_days IS NULL OR nudge_after_days BETWEEN 1 AND 30),
  nudged_at        timestamptz,
  replied_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_meeting_followup_sends_meeting_idx
  ON live_meeting_followup_sends (meeting_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_meeting_followup_sends_due_idx
  ON live_meeting_followup_sends (status, scheduled_for)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS live_meeting_followup_sends_nudge_idx
  ON live_meeting_followup_sends (status, sent_at)
  WHERE status = 'sent' AND nudge_after_days IS NOT NULL AND nudged_at IS NULL AND replied_at IS NULL;

CREATE TABLE IF NOT EXISTS followup_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  body            text        NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS followup_templates_org_idx ON followup_templates (organization_id, name);

ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS chased_at timestamptz;
ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS chase_count integer NOT NULL DEFAULT 0;

ALTER TABLE live_meeting_followup_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_followup_sends_host_read" ON live_meeting_followup_sends;
DROP POLICY IF EXISTS "followup_templates_org_read" ON followup_templates;

-- The host reads what went out over their name; nobody writes directly.
do $$ begin
  CREATE POLICY "live_meeting_followup_sends_host_read" ON live_meeting_followup_sends
  FOR SELECT USING (meeting_id IN (SELECT id FROM live_meetings WHERE host_id = auth.uid()));
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "followup_templates_org_read" ON followup_templates
  FOR SELECT USING (organization_id IN (SELECT public.current_principal_org_ids()));
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE live_meeting_followup_sends IS
  'One row per recipient per follow-up send: scheduled, sent, failed or cancelled, with nudge state.';
COMMENT ON TABLE followup_templates IS
  'A firm''s saved follow-up emails, with {{first_name}} / {{summary}} / {{action_items}} style tokens.';
COMMENT ON COLUMN team_tasks.chased_at IS 'When an overdue meeting action item was last chased with its owner.';
