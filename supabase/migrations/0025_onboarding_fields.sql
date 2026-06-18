-- Onboarding wizard fields captured during organization setup.
-- These power agent context: primary_strategy calibrates deal templates and
-- diligence checklists, operator_role tunes hub defaults and agent behavior,
-- first_hub sets the activation entry point post-onboarding.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hq_location       text,
  ADD COLUMN IF NOT EXISTS operator_role     text,
  ADD COLUMN IF NOT EXISTS aum_range         text,
  ADD COLUMN IF NOT EXISTS fund_count        integer,
  ADD COLUMN IF NOT EXISTS primary_strategy  text,
  ADD COLUMN IF NOT EXISTS first_hub         text;

-- Constrain first_hub to valid hub keys
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_first_hub_check
    CHECK (first_hub IS NULL OR first_hub IN ('build', 'source', 'run', 'execute'));

-- Constrain operator_role to known values
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_operator_role_check
    CHECK (operator_role IS NULL OR operator_role IN ('gp', 'family_office', 'advisory', 'operator'));

-- Constrain aum_range to known buckets
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_aum_range_check
    CHECK (aum_range IS NULL OR aum_range IN ('sub_25m', '25m_100m', '100m_500m', '500m_1b', 'over_1b'));

COMMENT ON COLUMN public.organizations.hq_location      IS 'City/state of principal office, captured during onboarding';
COMMENT ON COLUMN public.organizations.operator_role    IS 'gp | family_office | advisory | operator — drives hub defaults';
COMMENT ON COLUMN public.organizations.aum_range        IS 'AUM bucket selected during onboarding';
COMMENT ON COLUMN public.organizations.fund_count       IS 'Number of active funds at onboarding time';
COMMENT ON COLUMN public.organizations.primary_strategy IS 'real_estate | private_equity | credit | multi — calibrates agent templates';
COMMENT ON COLUMN public.organizations.first_hub        IS 'Hub the operator chose to activate first; used for post-onboarding redirect';
