-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- PR Reviews: log every GitHub PR code review
CREATE TABLE IF NOT EXISTS public.pr_reviews (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  repo text NOT NULL,
  pr_number integer NOT NULL,
  pr_title text,
  pr_author text,
  pr_url text,
  branch_from text,
  branch_into text,
  files_changed integer,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed','failed')),
  review_summary text,
  review_comments jsonb DEFAULT '[]'::jsonb,
  severity text CHECK (severity IN ('clean','minor','moderate','critical')),
  github_comment_id bigint,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pr_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read pr_reviews"
  ON public.pr_reviews FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE principal_id = auth.uid()
  ));

-- Webhook Logs: log every inbound webhook with routing outcome
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  source text NOT NULL,
  event_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  routed_to text,
  routed_record_id uuid,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','routed','failed','ignored')),
  error_message text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read webhook_logs"
  ON public.webhook_logs FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE principal_id = auth.uid()
  ));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS pr_reviews_repo_pr_idx ON public.pr_reviews(repo, pr_number);
CREATE INDEX IF NOT EXISTS pr_reviews_created_at_idx ON public.pr_reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_logs_source_idx ON public.webhook_logs(source, event_type);
CREATE INDEX IF NOT EXISTS webhook_logs_created_at_idx ON public.webhook_logs(created_at DESC);;
