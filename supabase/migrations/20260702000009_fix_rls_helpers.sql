-- Fix RLS policies on canvas, nda_signatures, and docusign_envelopes tables
-- to use the established current_principal_org_ids() / is_org_writer() helpers.

-- canvases: replace LIMIT 1 subquery with helper functions
DROP POLICY IF EXISTS "org members" ON public.canvases;

CREATE POLICY "canvases_select" ON public.canvases
  FOR SELECT USING (organization_id IN (SELECT public.current_principal_org_ids()));

CREATE POLICY "canvases_write" ON public.canvases
  FOR ALL USING (public.is_org_writer(organization_id))
  WITH CHECK (public.is_org_writer(organization_id));

-- canvas_elements: replace LIMIT 1 subquery with helper functions
DROP POLICY IF EXISTS "org members" ON public.canvas_elements;

CREATE POLICY "canvas_elements_select" ON public.canvas_elements
  FOR SELECT USING (organization_id IN (SELECT public.current_principal_org_ids()));

CREATE POLICY "canvas_elements_write" ON public.canvas_elements
  FOR ALL USING (public.is_org_writer(organization_id))
  WITH CHECK (public.is_org_writer(organization_id));

-- nda_signatures: replace LIMIT 1 subquery with helper function
DROP POLICY IF EXISTS "org read" ON public.nda_signatures;

CREATE POLICY "nda_signatures_select" ON public.nda_signatures
  FOR SELECT USING (organization_id IN (SELECT public.current_principal_org_ids()));
-- Insert remains service-role only (no authenticated-role insert policy).

-- docusign_envelopes: replace LIMIT 1 subquery with helper functions
DROP POLICY IF EXISTS "org members" ON public.docusign_envelopes;

CREATE POLICY "docusign_envelopes_select" ON public.docusign_envelopes
  FOR SELECT USING (organization_id IN (SELECT public.current_principal_org_ids()));

CREATE POLICY "docusign_envelopes_write" ON public.docusign_envelopes
  FOR ALL USING (public.is_org_writer(organization_id))
  WITH CHECK (public.is_org_writer(organization_id));
