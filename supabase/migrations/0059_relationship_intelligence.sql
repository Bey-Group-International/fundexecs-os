-- Relationship intelligence layer: scoring, cadences, meeting briefs, next best actions

-- Relationship scores: computed health score per investor per org
CREATE TABLE relationship_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  temperature TEXT NOT NULL DEFAULT 'cold' CHECK (temperature IN ('cold','warm','active','committed')),
  last_contact_at TIMESTAMPTZ,
  days_since_contact INTEGER,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  decay_alert BOOLEAN NOT NULL DEFAULT false,
  decay_days INTEGER,
  score_breakdown JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, investor_id)
);
CREATE INDEX ON relationship_scores(organization_id);
CREATE INDEX ON relationship_scores(investor_id);
CREATE INDEX ON relationship_scores(decay_alert) WHERE decay_alert = true;
ALTER TABLE relationship_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON relationship_scores
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));

-- Outreach cadences: scheduled touch plans per investor
CREATE TABLE cadences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  created_by UUID REFERENCES principals(id),
  name TEXT NOT NULL,
  frequency_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_touch_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ,
  overdue BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON cadences(organization_id);
CREATE INDEX ON cadences(investor_id);
CREATE INDEX ON cadences(next_due_at);
CREATE INDEX ON cadences(overdue) WHERE overdue = true;
ALTER TABLE cadences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON cadences
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));

-- Meeting briefs: AI-generated pre-meeting intelligence
CREATE TABLE meeting_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investor_id UUID REFERENCES investors(id) ON DELETE SET NULL,
  created_by UUID REFERENCES principals(id),
  meeting_title TEXT NOT NULL,
  meeting_at TIMESTAMPTZ NOT NULL,
  attendees TEXT[] NOT NULL DEFAULT '{}',
  brief_content JSONB NOT NULL DEFAULT '{}',
  -- brief_content shape: { summary, last_interaction, open_asks, fund_fit, talking_points[], risks[] }
  source TEXT NOT NULL DEFAULT 'calendly' CHECK (source IN ('calendly','google_calendar','zoom','manual')),
  external_event_id TEXT,
  generated_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON meeting_briefs(organization_id);
CREATE INDEX ON meeting_briefs(investor_id);
CREATE INDEX ON meeting_briefs(meeting_at);
ALTER TABLE meeting_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON meeting_briefs
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));

-- Next best actions: prioritized recommended moves per org
CREATE TABLE next_best_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  -- action_type: contact_overdue | cadence_due | meeting_prep | deal_followup | lp_update | intro_request
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  title TEXT NOT NULL,
  description TEXT,
  context_summary TEXT,
  copilot_prompt TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON next_best_actions(organization_id);
CREATE INDEX ON next_best_actions(investor_id);
CREATE INDEX ON next_best_actions(priority DESC);
CREATE INDEX ON next_best_actions(completed_at) WHERE completed_at IS NULL;
ALTER TABLE next_best_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member" ON next_best_actions
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()));
