-- Migration: native document signing system (envelopes).
--
-- Four tables replicate the core DocuSign object model natively:
--   envelopes           — the signing package (document + metadata)
--   envelope_recipients — one row per signer, each with a unique signing token
--   envelope_fields     — signature/text/date/checkbox fields placed on the document
--   envelope_events     — immutable audit trail

-- ── envelopes ────────────────────────────────────────────────────────────────

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

COMMENT ON TABLE envelopes IS 'Native signing envelopes — document + metadata for signature workflows.';
COMMENT ON COLUMN envelopes.document_type IS 'text = markdown/plain (now); pdf = uploaded file (future).';
COMMENT ON COLUMN envelopes.status IS 'draft → sent → partially_signed → completed | voided.';

ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS envelopes_organization_id_idx ON envelopes(organization_id);
CREATE INDEX IF NOT EXISTS envelopes_status_idx ON envelopes(status);

DROP POLICY IF EXISTS "org_members_envelopes" ON envelopes;
CREATE POLICY "org_members_envelopes" ON envelopes
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

-- ── envelope_recipients ───────────────────────────────────────────────────────

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

COMMENT ON TABLE envelope_recipients IS 'Signers for an envelope; each issued a unique public signing token.';
COMMENT ON COLUMN envelope_recipients.signing_token IS 'UUID used in /sign/[token] URL — no auth required to sign.';
COMMENT ON COLUMN envelope_recipients.signature_data IS 'Base64 PNG of drawn or typed signature.';

ALTER TABLE envelope_recipients ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS envelope_recipients_envelope_id_idx ON envelope_recipients(envelope_id);
CREATE INDEX IF NOT EXISTS envelope_recipients_signing_token_idx ON envelope_recipients(signing_token);

DROP POLICY IF EXISTS "org_members_envelope_recipients" ON envelope_recipients;
CREATE POLICY "org_members_envelope_recipients" ON envelope_recipients
  FOR ALL USING (
    envelope_id IN (
      SELECT e.id FROM envelopes e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.principal_id = auth.uid()
    )
  );

-- ── envelope_fields ───────────────────────────────────────────────────────────

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

COMMENT ON TABLE envelope_fields IS 'Positioned fields on document pages assigned to specific recipients.';
COMMENT ON COLUMN envelope_fields.x_pct IS 'Horizontal position as percentage (0–100) of page width from left.';
COMMENT ON COLUMN envelope_fields.y_pct IS 'Vertical position as percentage (0–100) of page height from top.';

ALTER TABLE envelope_fields ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS envelope_fields_envelope_id_idx ON envelope_fields(envelope_id);
CREATE INDEX IF NOT EXISTS envelope_fields_recipient_id_idx ON envelope_fields(recipient_id);

DROP POLICY IF EXISTS "org_members_envelope_fields" ON envelope_fields;
CREATE POLICY "org_members_envelope_fields" ON envelope_fields
  FOR ALL USING (
    envelope_id IN (
      SELECT e.id FROM envelopes e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.principal_id = auth.uid()
    )
  );

-- ── envelope_events ───────────────────────────────────────────────────────────

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

COMMENT ON TABLE envelope_events IS 'Immutable audit trail of all actions on an envelope.';
COMMENT ON COLUMN envelope_events.metadata IS 'JSON context: field ids, user agent, etc.';

ALTER TABLE envelope_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS envelope_events_envelope_id_idx ON envelope_events(envelope_id);
CREATE INDEX IF NOT EXISTS envelope_events_created_at_idx ON envelope_events(created_at);

DROP POLICY IF EXISTS "org_members_envelope_events" ON envelope_events;
CREATE POLICY "org_members_envelope_events" ON envelope_events
  FOR ALL USING (
    envelope_id IN (
      SELECT e.id FROM envelopes e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.principal_id = auth.uid()
    )
  );
