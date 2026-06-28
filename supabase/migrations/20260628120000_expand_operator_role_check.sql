-- Expand the operator_role CHECK constraint to include all roles surfaced in
-- the profile dropdown (lp, sponsor, placement_agent, fund_administrator, ria, other).
-- The original constraint only permitted gp | family_office | advisory | operator.

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_operator_role_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_operator_role_check
    CHECK (
      operator_role IS NULL OR operator_role IN (
        'gp', 'family_office', 'advisory', 'operator',
        'lp', 'sponsor', 'placement_agent', 'fund_administrator', 'ria', 'other'
      )
    );

COMMENT ON COLUMN public.organizations.operator_role IS
  'gp | family_office | advisory | operator | lp | sponsor | placement_agent | fund_administrator | ria | other';
