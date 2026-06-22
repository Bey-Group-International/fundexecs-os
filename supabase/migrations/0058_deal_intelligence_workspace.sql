-- Deal Intelligence Feed + Knowledge Workspace

-- Deal intelligence signals: external market signals, tagged by sector
CREATE TABLE deal_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','pitchbook','crunchbase','cbinsights','sec_filing','news','ai_extracted')),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('funding_round','acquisition','ipo','bankruptcy','exec_change','partnership','market_entry','exit','lp_activity','regulatory')),
  title TEXT NOT NULL,
  summary TEXT,
  sector TEXT,
  subsector TEXT,
  geography TEXT,
  company_name TEXT,
  deal_size_min NUMERIC(18,2),
  deal_size_max NUMERIC(18,2),
  deal_stage TEXT,
  relevance_score INTEGER DEFAULT 50 CHECK (relevance_score >= 0 AND relevance_score <= 100),
  thesis_match_score INTEGER DEFAULT 0 CHECK (thesis_match_score >= 0 AND thesis_match_score <= 100),
  source_url TEXT,
  published_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON deal_signals(organization_id);
CREATE INDEX ON deal_signals(sector);
CREATE INDEX ON deal_signals(signal_type);
CREATE INDEX ON deal_signals(thesis_match_score DESC);
CREATE INDEX ON deal_signals(published_at DESC);
CREATE INDEX ON deal_signals(read_at) WHERE read_at IS NULL;
ALTER TABLE deal_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON deal_signals
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));

-- Sector heatmap snapshots: aggregated deal activity per sector/stage
CREATE TABLE sector_heatmap_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sector TEXT NOT NULL,
  stage TEXT NOT NULL,
  deal_count INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(18,2) DEFAULT 0,
  avg_value NUMERIC(18,2),
  yoy_change_pct NUMERIC(8,2),
  activity_level TEXT NOT NULL DEFAULT 'low' CHECK (activity_level IN ('low','moderate','high','very_high')),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, sector, stage, snapshot_date)
);
CREATE INDEX ON sector_heatmap_snapshots(organization_id);
CREATE INDEX ON sector_heatmap_snapshots(sector, stage);
ALTER TABLE sector_heatmap_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON sector_heatmap_snapshots
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));

-- Knowledge workspace: block-based documents (Notion clone)
CREATE TABLE workspace_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES principals(id),
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'note' CHECK (doc_type IN ('note','ic_memo','fund_thesis','deal_memo','diligence_report','lp_update','template','wiki')),
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  fund_id UUID REFERENCES funds(id) ON DELETE SET NULL,
  investor_id UUID REFERENCES investors(id) ON DELETE SET NULL,
  blocks JSONB NOT NULL DEFAULT '[]',
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_template BOOLEAN NOT NULL DEFAULT false,
  last_edited_by UUID REFERENCES principals(id),
  last_edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON workspace_documents(organization_id);
CREATE INDEX ON workspace_documents(doc_type);
CREATE INDEX ON workspace_documents(deal_id);
CREATE INDEX ON workspace_documents(fund_id);
CREATE INDEX ON workspace_documents(is_pinned) WHERE is_pinned = true;
ALTER TABLE workspace_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON workspace_documents
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));
