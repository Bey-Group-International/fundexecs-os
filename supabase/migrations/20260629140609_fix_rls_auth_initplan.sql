-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- Replace direct auth.uid() calls in USING/WITH CHECK clauses with
-- (SELECT auth.uid()) subqueries so Postgres evaluates them once per
-- query instead of once per row.

-- principals_select
DROP POLICY IF EXISTS principals_select ON public.principals;
CREATE POLICY principals_select ON public.principals
  FOR SELECT USING (
    (id = (SELECT auth.uid()))
    OR id IN (
      SELECT organization_members.principal_id
      FROM organization_members
      WHERE organization_members.organization_id IN (SELECT current_principal_org_ids())
    )
  );

-- principals_update_self
DROP POLICY IF EXISTS principals_update_self ON public.principals;
CREATE POLICY principals_update_self ON public.principals
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- organizations_insert
DROP POLICY IF EXISTS organizations_insert ON public.organizations;
CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT WITH CHECK (
    ((SELECT auth.uid()) IS NOT NULL)
    AND (created_by = (SELECT auth.uid()))
  );

-- agents_select
DROP POLICY IF EXISTS agents_select ON public.ai_agents;
CREATE POLICY agents_select ON public.ai_agents
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated'::text);

-- org members can read pr_reviews
DROP POLICY IF EXISTS "org members can read pr_reviews" ON public.pr_reviews;
CREATE POLICY "org members can read pr_reviews" ON public.pr_reviews
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_members.organization_id
      FROM organization_members
      WHERE organization_members.principal_id = (SELECT auth.uid())
    )
  );

-- org members can read webhook_logs
DROP POLICY IF EXISTS "org members can read webhook_logs" ON public.webhook_logs;
CREATE POLICY "org members can read webhook_logs" ON public.webhook_logs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_members.organization_id
      FROM organization_members
      WHERE organization_members.principal_id = (SELECT auth.uid())
    )
  );;
