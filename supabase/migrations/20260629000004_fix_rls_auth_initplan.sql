-- P2-2: Replace direct auth.uid() calls in RLS policies with (SELECT auth.uid())
-- subquery pattern to prevent per-row re-evaluation (auth_rls_initplan advisor).
-- Affected tables: principals, organizations, ai_agents, pr_reviews, webhook_logs.

-- principals
DROP POLICY IF EXISTS "principals_select" ON public.principals;
DROP POLICY IF EXISTS "principals_insert" ON public.principals;
DROP POLICY IF EXISTS "principals_update" ON public.principals;
DROP POLICY IF EXISTS "principals_delete" ON public.principals;

CREATE POLICY "principals_select" ON public.principals
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "principals_insert" ON public.principals
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "principals_update" ON public.principals
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "principals_delete" ON public.principals
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- organizations (via membership)
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
DROP POLICY IF EXISTS "organizations_update" ON public.organizations;

CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    id IN (
      SELECT organization_id FROM public.principals
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    id IN (
      SELECT organization_id FROM public.principals
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'owner')
    )
  );

-- ai_agents
DROP POLICY IF EXISTS "ai_agents_select" ON public.ai_agents;

CREATE POLICY "ai_agents_select" ON public.ai_agents
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.principals
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- pr_reviews
DROP POLICY IF EXISTS "pr_reviews_select" ON public.pr_reviews;

CREATE POLICY "pr_reviews_select" ON public.pr_reviews
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.principals
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- webhook_logs
DROP POLICY IF EXISTS "webhook_logs_select" ON public.webhook_logs;

CREATE POLICY "webhook_logs_select" ON public.webhook_logs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.principals
      WHERE user_id = (SELECT auth.uid())
    )
  );
