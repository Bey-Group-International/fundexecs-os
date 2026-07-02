CREATE TABLE IF NOT EXISTS public.nda_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.data_room_shares(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  signer_name text NOT NULL,
  signer_email text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip_hint text -- first 3 octets of IP for audit, stored by server action
);

ALTER TABLE public.nda_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org read" ON public.nda_signatures FOR SELECT USING (
  organization_id = (SELECT organization_id FROM public.organization_members WHERE principal_id = auth.uid() LIMIT 1)
);
-- Insert is allowed from service role only (server action uses service client)
