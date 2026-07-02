-- DocuSign envelopes: tracks subscription agreements sent via DocuSign.
CREATE TABLE IF NOT EXISTS public.docusign_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  envelope_id text NOT NULL,
  template_id text,
  signer_name text,
  signer_email text,
  subject text,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.docusign_envelopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members" ON public.docusign_envelopes
  FOR ALL
  USING (
    organization_id = (
      SELECT organization_id
      FROM public.organization_members
      WHERE principal_id = auth.uid()
      LIMIT 1
    )
  );
