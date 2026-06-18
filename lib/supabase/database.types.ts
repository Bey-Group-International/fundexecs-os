// database.types.ts
// Hand-authored to mirror supabase/migrations. Regenerate from a live project
// with `npm run db:types` (supabase gen types) once a DB is provisioned.

export type Hub = "build" | "source" | "run" | "execute";

export type AgentKey =
  | "analyst"
  | "associate"
  | "investor_relations"
  | "portfolio_ops"
  | "diligence"
  | "fund_admin";

export type GraphKind = "relationship" | "deal" | "capital";
export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type InvestorType =
  | "lp"
  | "family_office"
  | "institution"
  | "fund_of_funds"
  | "lender"
  | "bank"
  | "co_gp"
  | "other";
export type FundType = "fund" | "spv" | "co_invest" | "separate_account";
export type DealStage =
  | "sourced"
  | "screening"
  | "diligence"
  | "underwriting"
  | "ic_review"
  | "closing"
  | "owned"
  | "exited"
  | "passed"
  | "dead";
export type AssetType =
  | "real_estate"
  | "operating_company"
  | "portfolio_company"
  | "fund_interest"
  | "other";
export type CapitalEventType =
  | "capital_call"
  | "distribution"
  | "contribution"
  | "fee"
  | "return_of_capital"
  | "carry";
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type ApprovalDecision = "pending" | "approved" | "rejected" | "regenerate";
export type DiligenceStatus = "open" | "in_review" | "cleared" | "flagged" | "waived";
export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type MarketplaceStatus = "draft" | "listed" | "paused" | "closed";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// Common audit columns present on most tables.
interface Timestamps {
  created_at: string;
  updated_at: string;
}

export interface Principal {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization extends Timestamps {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  entity_type: string | null;
  jurisdiction: string | null;
  website: string | null;
  logo_url: string | null;
  brand_color: string | null;
  description: string | null;
  created_by: string | null;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  principal_id: string;
  role: MemberRole;
  created_at: string;
}

export interface InvestmentThesis extends Timestamps {
  id: string;
  organization_id: string;
  title: string;
  summary: string | null;
  asset_classes: string[];
  geographies: string[];
  check_size_min: number | null;
  check_size_max: number | null;
  target_irr: number | null;
  target_moic: number | null;
  is_active: boolean;
}

export interface Investor extends Timestamps {
  id: string;
  organization_id: string;
  name: string;
  investor_type: InvestorType;
  contact_name: string | null;
  contact_email: string | null;
  jurisdiction: string | null;
  aum: number | null;
  typical_check_min: number | null;
  typical_check_max: number | null;
  notes: string | null;
  pipeline_stage: string;
}

export interface Fund extends Timestamps {
  id: string;
  organization_id: string;
  name: string;
  fund_type: FundType;
  vintage_year: number | null;
  target_size: number | null;
  committed_capital: number;
  called_capital: number;
  distributed_capital: number;
  currency: string;
}

export interface Commitment extends Timestamps {
  id: string;
  organization_id: string;
  fund_id: string;
  investor_id: string;
  committed_amount: number;
  called_amount: number;
  distributed_amount: number;
  committed_at: string | null;
}

export interface CapitalEvent extends Timestamps {
  id: string;
  organization_id: string;
  fund_id: string;
  investor_id: string | null;
  event_type: CapitalEventType;
  amount: number;
  currency: string;
  effective_date: string;
  due_date: string | null;
  reference: string | null;
  notes: string | null;
}

export interface Deal extends Timestamps {
  id: string;
  organization_id: string;
  name: string;
  stage: DealStage;
  asset_class: string | null;
  geography: string | null;
  target_amount: number | null;
  fund_id: string | null;
  source: string | null;
  lead_principal: string | null;
  thesis_fit: number | null;
  expected_close: string | null;
  notes: string | null;
}

export interface Asset extends Timestamps {
  id: string;
  organization_id: string;
  deal_id: string | null;
  fund_id: string | null;
  name: string;
  asset_type: AssetType;
  acquisition_date: string | null;
  acquisition_cost: number | null;
  current_value: number | null;
  noi: number | null;
  cap_rate: number | null;
  status: string;
}

export interface Underwriting extends Timestamps {
  id: string;
  organization_id: string;
  deal_id: string;
  name: string;
  scenario: string;
  model: Json;
  projected_irr: number | null;
  projected_moic: number | null;
  equity_required: number | null;
  created_by: string | null;
}

export interface DiligenceItem extends Timestamps {
  id: string;
  organization_id: string;
  deal_id: string;
  document_id: string | null;
  category: string;
  title: string;
  status: DiligenceStatus;
  risk_severity: RiskSeverity | null;
  finding: string | null;
}

export interface Relationship extends Timestamps {
  id: string;
  organization_id: string;
  graph: GraphKind;
  from_entity_type: string;
  from_entity_id: string;
  to_entity_type: string;
  to_entity_id: string;
  relation: string;
  strength: number | null;
  metadata: Json;
}

export interface AiAgent {
  key: AgentKey;
  name: string;
  hub: Hub | null;
  role: string;
  color: string;
  motion_style: string | null;
  capabilities: string[];
  created_at: string;
}

export interface Task extends Timestamps {
  id: string;
  organization_id: string;
  prompt_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  hub: Hub;
  assigned_agent: AgentKey;
  status: TaskStatus;
  progress: number;
  graph_touched: GraphKind | null;
  requires_approval: boolean;
  result: Json | null;
  created_by: string | null;
  completed_at: string | null;
}

export interface Approval extends Timestamps {
  id: string;
  organization_id: string;
  task_id: string;
  requested_by_agent: AgentKey | null;
  summary: string;
  decision: ApprovalDecision;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

export interface TaskEvent {
  id: string;
  organization_id: string;
  task_id: string | null;
  event_type: string;
  agent: AgentKey | null;
  hub: Hub | null;
  payload: Json;
  created_at: string;
}

export interface MarketplaceListing extends Timestamps {
  id: string;
  organization_id: string;
  title: string;
  listing_type: string;
  summary: string | null;
  deal_id: string | null;
  fund_id: string | null;
  amount: number | null;
  status: MarketplaceStatus;
  is_public: boolean;
  metadata: Json;
}

// Minimal Database shape compatible with @supabase/supabase-js generics.
// Insert/Update use Partial for ergonomics until full generated types land.
type TableShape<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      principals: TableShape<Principal>;
      organizations: TableShape<Organization>;
      organization_members: TableShape<OrganizationMember>;
      investment_theses: TableShape<InvestmentThesis>;
      investors: TableShape<Investor>;
      funds: TableShape<Fund>;
      commitments: TableShape<Commitment>;
      capital_events: TableShape<CapitalEvent>;
      deals: TableShape<Deal>;
      assets: TableShape<Asset>;
      underwritings: TableShape<Underwriting>;
      diligence_items: TableShape<DiligenceItem>;
      relationships: TableShape<Relationship>;
      ai_agents: TableShape<AiAgent>;
      tasks: TableShape<Task>;
      approvals: TableShape<Approval>;
      task_events: TableShape<TaskEvent>;
      marketplace_listings: TableShape<MarketplaceListing>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      hub: Hub;
      agent_key: AgentKey;
      graph_kind: GraphKind;
      member_role: MemberRole;
      investor_type: InvestorType;
      fund_type: FundType;
      deal_stage: DealStage;
      asset_type: AssetType;
      capital_event_type: CapitalEventType;
      task_status: TaskStatus;
      approval_decision: ApprovalDecision;
      diligence_status: DiligenceStatus;
      risk_severity: RiskSeverity;
      marketplace_status: MarketplaceStatus;
    };
  };
}
