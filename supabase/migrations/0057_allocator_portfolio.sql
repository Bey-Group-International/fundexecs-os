-- Allocator Intelligence Directory + Portfolio Health

-- Allocator profiles: enriched data on family offices, institutions, RIAs
-- References contacts (LP/allocator contacts) rather than a non-existent investors table
CREATE TABLE IF NOT EXISTS public.allocator_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Enriched fields beyond the base contacts table
  aum_min NUMERIC(18,2),
  aum_max NUMERIC(18,2),
  aum_currency TEXT DEFAULT 'USD',
  typical_ticket_min NUMERIC(18,2),
  typical_ticket_max NUMERIC(18,2),
  allocator_type TEXT CHECK (allocator_type IN ('family_office','ria','endowment','foundation','pension','sovereign','fund_of_funds','institutional','other')),
  primary_strategies TEXT[] DEFAULT '{}',
  -- e.g. ['real_estate','private_equity','private_credit','venture']
  geographic_focus TEXT[] DEFAULT '{}',
  -- e.g. ['US','Europe','Southeast']
  accreditation_status TEXT DEFAULT 'unknown' CHECK (accreditation_status IN ('unknown','accredited_investor','qualified_purchaser','qualified_client','institutional','pending_verification')),
  kyc_status TEXT DEFAULT 'not_started' CHECK (kyc_status IN ('not_started','in_progress','verified','expired')),
  kyc_verified_at TIMESTAMPTZ,
  kyc_expires_at TIMESTAMPTZ,
  is_qualified_purchaser BOOLEAN,
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  website TEXT,
  linkedin_url TEXT,
  hq_city TEXT,
  hq_state TEXT,
  hq_country TEXT DEFAULT 'US',
  portfolio_count INTEGER,
  co_invest_appetite BOOLEAN,
  preferred_structures TEXT[] DEFAULT '{}',
  -- e.g. ['fund','spv','co_invest','direct']
  notes TEXT,
  last_enriched_at TIMESTAMPTZ,
  data_source TEXT DEFAULT 'manual' CHECK (data_source IN ('manual','import','api','ai_extracted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS allocator_profiles_org_id_idx ON public.allocator_profiles(org_id);
CREATE INDEX IF NOT EXISTS allocator_profiles_contact_id_idx ON public.allocator_profiles(contact_id);
CREATE INDEX IF NOT EXISTS allocator_profiles_allocator_type_idx ON public.allocator_profiles(allocator_type);
CREATE INDEX IF NOT EXISTS allocator_profiles_accreditation_status_idx ON public.allocator_profiles(accreditation_status);
CREATE INDEX IF NOT EXISTS allocator_profiles_kyc_status_idx ON public.allocator_profiles(kyc_status);
ALTER TABLE public.allocator_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allocator_profiles_org_member" ON public.allocator_profiles
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

-- Portfolio metrics: computed performance per deal/asset
CREATE TABLE IF NOT EXISTS public.portfolio_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- Performance metrics
  irr_pct NUMERIC(8,4),           -- e.g. 18.5 = 18.5%
  moic NUMERIC(8,4),              -- e.g. 2.3 = 2.3x
  dpi NUMERIC(8,4),               -- distributions to paid-in
  rvpi NUMERIC(8,4),              -- residual value to paid-in
  tvpi NUMERIC(8,4),              -- total value to paid-in
  equity_invested NUMERIC(18,2),
  current_value NUMERIC(18,2),
  total_distributions NUMERIC(18,2) DEFAULT 0,
  -- Allocation metadata
  sector TEXT,
  geography TEXT,
  asset_class TEXT,
  hold_period_months INTEGER,
  entry_date DATE,
  projected_exit_date DATE,
  -- Risk flags
  is_underperforming BOOLEAN NOT NULL DEFAULT false,
  concentration_pct NUMERIC(6,2),  -- % of total portfolio NAV
  risk_flags TEXT[] DEFAULT '{}',
  -- Underwrite comparison
  underwrite_irr_pct NUMERIC(8,4),
  underwrite_moic NUMERIC(8,4),
  variance_to_underwrite_pct NUMERIC(8,4),
  -- Scenarios
  bear_case_moic NUMERIC(8,4),
  base_case_moic NUMERIC(8,4),
  bull_case_moic NUMERIC(8,4),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, deal_id)
);
CREATE INDEX IF NOT EXISTS portfolio_metrics_org_id_idx ON public.portfolio_metrics(org_id);
CREATE INDEX IF NOT EXISTS portfolio_metrics_deal_id_idx ON public.portfolio_metrics(deal_id);
CREATE INDEX IF NOT EXISTS portfolio_metrics_underperforming_idx ON public.portfolio_metrics(is_underperforming) WHERE is_underperforming = true;
ALTER TABLE public.portfolio_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portfolio_metrics_org_member" ON public.portfolio_metrics
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

-- Portfolio risk flags: concentration + allocation analysis
CREATE TABLE IF NOT EXISTS public.portfolio_risk_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('concentration','underperformance','sector_overweight','geography_overweight','liquidity','hold_period')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_deal_ids UUID[] DEFAULT '{}',
  threshold_pct NUMERIC(6,2),
  actual_pct NUMERIC(6,2),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS portfolio_risk_alerts_org_id_idx ON public.portfolio_risk_alerts(org_id);
CREATE INDEX IF NOT EXISTS portfolio_risk_alerts_severity_idx ON public.portfolio_risk_alerts(severity);
CREATE INDEX IF NOT EXISTS portfolio_risk_alerts_unresolved_idx ON public.portfolio_risk_alerts(resolved_at) WHERE resolved_at IS NULL;
ALTER TABLE public.portfolio_risk_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portfolio_risk_alerts_org_member" ON public.portfolio_risk_alerts
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));
