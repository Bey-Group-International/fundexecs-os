-- P2-2: Replace bare auth.uid() calls in RLS policies with (SELECT auth.uid())
-- subquery pattern to prevent per-row re-evaluation (auth_rls_initplan advisor).
-- Affected tables: principals, organizations, ai_agents, pr_reviews, webhook_logs.

-- principals
DROP POLICY IF EXISTS "principals_select" ON public.principals;
DROP POLICY IF EXISTS "principals_update_self" ON public.principals;

CREATE POLICY "principals_select" ON public.principals
  FOR SELECT USING (
    (id = (SELECT auth.uid()))
    OR (id IN (
      SELECT organization_members.principal_id
      FROM organization_members
      WHERE organization_members.organization_id IN (SELECT current_principal_org_ids())
    ))
  );

CREATE POLICY "principals_update_self" ON public.principals
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- organizations
DROP POLICY IF EXISTS "organizations_insert" ON public.organizations;

CREATE POLICY "organizations_insert" ON public.organizations
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND created_by = (SELECT auth.uid())
  );

-- pr_reviews (table may not exist in fresh preview branches)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pr_reviews') THEN
    DROP POLICY IF EXISTS "org members can read pr_reviews" ON public.pr_reviews;
    EXECUTE $p$
      CREATE POLICY "org members can read pr_reviews" ON public.pr_reviews
        FOR SELECT USING (
          organization_id IN (
            SELECT organization_members.organization_id
            FROM organization_members
            WHERE organization_members.principal_id = (SELECT auth.uid())
          )
        )
    $p$;
  END IF;
END $$;

-- webhook_logs (table may not exist in fresh preview branches)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'webhook_logs') THEN
    DROP POLICY IF EXISTS "org members can read webhook_logs" ON public.webhook_logs;
    EXECUTE $p$
      CREATE POLICY "org members can read webhook_logs" ON public.webhook_logs
        FOR SELECT USING (
          organization_id IN (
            SELECT organization_members.organization_id
            FROM organization_members
            WHERE organization_members.principal_id = (SELECT auth.uid())
          )
        )
    $p$;
  END IF;
END $$;
