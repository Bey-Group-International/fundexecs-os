-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS envelopes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title             text        NOT NULL,
  message           text,
  document_content  text,
  document_type     text        NOT NULL DEFAULT 'text'
                                CHECK (document_type IN ('text','pdf')),
  file_url          text,
  status            text        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','sent','partially_signed','completed','voided')),
  completed_at      timestamptz,
  voided_at         timestamptz,
  void_reason       text,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE envelopes IS 'Native signing envelopes — document + metadata for signature workflows.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS envelopes_organization_id_idx ON envelopes(organization_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS envelopes_status_idx ON envelopes(status);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_envelopes" ON envelopes;
CREATE POLICY "org_members_envelopes" ON envelopes
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS envelope_recipients (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id    uuid        NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  email          text        NOT NULL,
  routing_order  int         NOT NULL DEFAULT 1,
  signing_token  uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','viewed','signed','declined')),
  signed_at      timestamptz,
  declined_at    timestamptz,
  decline_reason text,
  ip_address     text,
  user_agent     text,
  signature_data text,
  initials_data  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE envelope_recipients IS 'Signers for an envelope;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$; each issued a unique public signing token.';

ALTER TABLE envelope_recipients ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS envelope_recipients_envelope_id_idx ON envelope_recipients(envelope_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS envelope_recipients_signing_token_idx ON envelope_recipients(signing_token);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_envelope_recipients" ON envelope_recipients;
CREATE POLICY "org_members_envelope_recipients" ON envelope_recipients
  FOR ALL USING (
    envelope_id IN (
      SELECT e.id FROM envelopes e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.principal_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS envelope_fields (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id  uuid    NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  recipient_id uuid    NOT NULL REFERENCES envelope_recipients(id) ON DELETE CASCADE,
  field_type   text    NOT NULL CHECK (field_type IN ('signature','initials','text','date','checkbox')),
  page         int     NOT NULL DEFAULT 1,
  x_pct        float   NOT NULL,
  y_pct        float   NOT NULL,
  width_pct    float   NOT NULL DEFAULT 20,
  height_pct   float   NOT NULL DEFAULT 5,
  label        text,
  required     boolean NOT NULL DEFAULT true,
  response     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE envelope_fields IS 'Positioned fields on document pages assigned to specific recipients.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE envelope_fields ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS envelope_fields_envelope_id_idx ON envelope_fields(envelope_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS envelope_fields_recipient_id_idx ON envelope_fields(recipient_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_envelope_fields" ON envelope_fields;
CREATE POLICY "org_members_envelope_fields" ON envelope_fields
  FOR ALL USING (
    envelope_id IN (
      SELECT e.id FROM envelopes e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.principal_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS envelope_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id  uuid        NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  recipient_id uuid        REFERENCES envelope_recipients(id) ON DELETE SET NULL,
  event_type   text        NOT NULL
               CHECK (event_type IN ('created','sent','viewed','signed','completed','voided','declined')),
  metadata     jsonb,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

do $$ begin
  COMMENT ON TABLE envelope_events IS 'Immutable audit trail of all actions on an envelope.';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

ALTER TABLE envelope_events ENABLE ROW LEVEL SECURITY;

do $$ begin
  CREATE INDEX IF NOT EXISTS envelope_events_envelope_id_idx ON envelope_events(envelope_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS envelope_events_created_at_idx ON envelope_events(created_at);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DROP POLICY IF EXISTS "org_members_envelope_events" ON envelope_events;
CREATE POLICY "org_members_envelope_events" ON envelope_events
  FOR ALL USING (
    envelope_id IN (
      SELECT e.id FROM envelopes e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.principal_id = auth.uid()
    )
  );;
