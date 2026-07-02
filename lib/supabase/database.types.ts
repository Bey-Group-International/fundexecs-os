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
  | "fund_admin"
  | "executive_advisor"
  | "capital_raiser"
  | "capital_connector"
  | "deal_sourcer"
  | "rainmaker"
  | "lead_generator"
  | "pr_director"
  | "seo_disruptor"
  | "curator";

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
export type ApprovalDecision = "pending" | "approved" | "rejected" | "regenerate" | "accepted";
export type DiligenceStatus = "open" | "in_review" | "cleared" | "flagged" | "waived";
export type ArtifactType =
  | "ic_memo"
  | "model"
  | "analysis"
  | "risk_report"
  | "lp_update"
  | "memo"
  | "summary"
  | "other";
export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type MarketplaceStatus = "draft" | "listed" | "paused" | "closed";
export type TriggerType = "schedule" | "manual" | "email" | "webhook" | "event";
export type SessionOrigin = "earn" | "workflow";
export type TeamTaskPriority = "low" | "normal" | "high" | "urgent";

// The Unified Inbox enums (migration 0038).
export type InboxChannel =
  | "gmail"
  | "slack"
  | "calendly"
  | "google_calendar"
  | "zoom"
  | "google_meet"
  | "docusign"
  | "ecosystem"
  | "deal_share"
  | "radar_digest"
  | "xero"
  | "jax";
export type InboxCategory = "messaging" | "booking" | "video" | "signing" | "finance";
export type InboxThreadStatus = "open" | "snoozed" | "done";
export type InboxDirection = "inbound" | "outbound";

// DocuSign envelopes (migration 20260702000008_docusign_envelopes).
export type DocusignEnvelope = {
  id: string;
  organization_id: string;
  envelope_id: string;
  template_id: string | null;
  signer_name: string | null;
  signer_email: string | null;
  subject: string | null;
  status: string;
  sent_at: string;
  completed_at: string | null;
};

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// Common audit columns present on most tables.
type Timestamps = {
  created_at: string;
  updated_at: string;
}

// Provenance + verification + soft-archive columns (migration 0032), present on
// every table-backed module record (Source, Run, Execute).
type RecordMeta = {
  provenance: string; // 'manual' | 'ai' | 'import'
  verification_status: string; // 'unverified' | 'verified'
  verified_at: string | null;
  verified_by: string | null;
  verification_note: string | null;
  archived_at: string | null;
}

export type Principal = {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  // Internal identity verification (migration 20260623140000). Set by an
  // owner/admin internal attestation now; an external KYC provider would set the
  // same columns later. Null until verified.
  identity_verified_at: string | null;
  identity_verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Organization = Timestamps & {
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
  hq_location: string | null;
  operator_role: string | null;
  aum_range: string | null;
  fund_count: number | null;
  primary_strategy: string | null;
  first_hub: string | null;
  discoverable: boolean;
  tagline: string | null;
  brand_voice: string | null;
  brand_palette: string[];
  // Org-level KYC posture (migration 20260623140000). 'unverified' by default;
  // internal attestation now, external-KYC provider hook later.
  kyc_status: string;
  kyc_verified_at: string | null;
  setup_hidden: boolean;
}

export type OrganizationMember = {
  id: string;
  organization_id: string;
  principal_id: string;
  role: MemberRole;
  created_at: string;
}

export type InvestmentThesis = Timestamps & {
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

export type Investor = Timestamps & RecordMeta & {
  id: string;
  organization_id: string;
  name: string;
  investor_type: InvestorType;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone?: string | null;
  role?: string | null;
  jurisdiction: string | null;
  aum: number | null;
  typical_check_min: number | null;
  typical_check_max: number | null;
  notes: string | null;
  pipeline_stage: string;
  session_id: string | null;
  website?: string | null;
  url_source?: string | null;
}

export type Fund = Timestamps & {
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

export type Commitment = Timestamps & {
  id: string;
  organization_id: string;
  fund_id: string;
  investor_id: string;
  committed_amount: number;
  called_amount: number;
  distributed_amount: number;
  committed_at: string | null;
  lifecycle_stage?: string;
  notes?: string | null;
}

export type CapitalEvent = Timestamps & RecordMeta & {
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

export type Deal = Timestamps & RecordMeta & {
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
  session_id: string | null;
  website?: string | null;
  role?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  url_source?: string | null;
  pipeline_stage_id?: string | null;
}

export type Asset = Timestamps & RecordMeta & {
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
  session_id: string | null;
}

export type Underwriting = Timestamps & RecordMeta & {
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

export type DiligenceItem = Timestamps & RecordMeta & {
  id: string;
  organization_id: string;
  deal_id: string;
  document_id: string | null;
  category: string;
  title: string;
  status: DiligenceStatus;
  risk_severity: RiskSeverity | null;
  finding: string | null;
  likelihood: RiskSeverity | null;
  mitigation: string | null;
  residual_severity: RiskSeverity | null;
  owner: string | null;
  due_date: string | null;
}

export type IcDecisionKind = "go" | "conditional" | "hold" | "no_go";

export type IcDecision = {
  id: string;
  organization_id: string;
  deal_id: string;
  decision: IcDecisionKind;
  rationale: string | null;
  conviction: number | null;
  decided_by: string | null;
  created_at: string;
};

export type ConvictionSnapshot = {
  id: string;
  organization_id: string;
  deal_id: string;
  score: number;
  stage: string;
  captured_at: string;
};

export type Relationship = Timestamps & {
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

export type AiAgent = {
  key: AgentKey;
  name: string;
  hub: Hub | null;
  role: string;
  color: string;
  motion_style: string | null;
  capabilities: string[];
  created_at: string;
}

export type Task = Timestamps & {
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
  step_order: number;
  automation_id: string | null;
  session_id: string | null;
  // Intelligence Layer routing (migration 0054). Free-text mirrors of the
  // LifecycleStage / TargetEngine unions in lib/intelligence.ts.
  lifecycle_stage: string | null;
  target_engine: string | null;
}

export type TeamTask = Timestamps & {
  id: string;
  organization_id: string;
  assigned_to: string;
  assigned_by: string | null;
  title: string;
  description: string | null;
  hub: Hub | null;
  module: string | null;
  priority: TeamTaskPriority;
  status: TaskStatus;
  due_at: string | null;
  session_id: string | null;
  source_task_id: string | null;
  deal_id: string | null;
  asset_id: string | null;
  context_snapshot: Json;
  completed_at: string | null;
}

export type SessionGroup = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  created_by: string | null;
};

export type Session = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  group_id: string | null;
  origin: SessionOrigin;
  automation_id: string | null;
  color: string | null;
  archived_at: string | null;
  pinned_at: string | null;
  unread: boolean;
  created_by: string | null;
  memory_card?: Json;
};

export type Entity = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  entity_type: string;
  jurisdiction: string | null;
  parent_entity_id: string | null;
  formation_date: string | null;
  notes: string | null;
  created_by: string | null;
};

export type Stakeholder = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  kind: string; // person | entity | investor | fund | pool | other
  email: string | null;
  notes: string | null;
  created_by: string | null;
  principal_id: string | null;
  investor_id: string | null;
};

export type ShareClass = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  name: string;
  kind: string; // common | preferred | lp_interest | gp_interest | membership | option | safe | note | other
  authorized_units: number | null;
};

export type EquityHolding = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  stakeholder_id: string;
  share_class_id: string | null;
  units: number | null;
  ownership_pct: number | null;
  invested_amount: number | null;
  notes: string | null;
  created_by: string | null;
};

export type Partner = Timestamps & RecordMeta & {
  id: string;
  organization_id: string;
  name: string;
  partner_type: string;
  relationship: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone?: string | null;
  role?: string | null;
  website?: string | null;
  url_source?: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
};

export type ServiceProvider = Timestamps & RecordMeta & {
  id: string;
  organization_id: string;
  name: string;
  provider_type: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone?: string | null;
  role?: string | null;
  url_source?: string | null;
  status: string;
  notes: string | null;
  website: string | null;
  created_by: string | null;
};

export type DebtFacility = Timestamps & RecordMeta & {
  id: string;
  organization_id: string;
  name: string;
  facility_type: string;
  lender: string | null;
  commitment_amount: number | null;
  interest_rate: number | null;
  currency: string;
  status: string;
  maturity_date: string | null;
  notes: string | null;
  created_by: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  role?: string | null;
  website?: string | null;
  url_source?: string | null;
};

export type Wallet = Timestamps & {
  id: string;
  organization_id: string;
  credits: number;
  plan: string | null;
  plan_interval: string | null;
  plan_started_at: string | null;
};

// Tokenization layers (migration 0048). Earned standing, credit stakes, and
// immutable attestations — see docs/TOKENIZATION_LAYERS.md.
export type ReputationTierName = "unranked" | "verified" | "established" | "principal";
export type ReputationScore = {
  organization_id: string;
  score: number;
  tier: ReputationTierName;
  updated_at: string;
};
export type ReputationLedgerEntry = {
  id: string;
  organization_id: string;
  delta: number;
  reason: string;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  created_at: string;
};
export type StakePosition = {
  id: string;
  organization_id: string;
  purpose: "listing" | "governance";
  ref_id: string | null;
  amount: number;
  status: "locked" | "returned" | "forfeited";
  note: string | null;
  created_at: string;
  resolved_at: string | null;
};
export type Attestation = {
  id: string;
  organization_id: string;
  subject_type: string;
  subject_id: string;
  claim: string;
  attested_by: string | null;
  witness_org_id: string | null;
  evidence_hash: string | null;
  settlement: "internal" | "anchored" | "onchain";
  anchor_ref: string | null;
  created_at: string;
};
// Stake forfeiture due-process record (migration 0051). An appealable challenge
// against a locked stake; no credit moves until it is resolved. See
// docs/TOKENIZATION_LAYERS.md §9.
export type StakeDispute = {
  id: string;
  organization_id: string;
  stake_id: string;
  status: "open" | "upheld" | "dismissed";
  reason: string | null;
  opened_by: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type SessionShare = {
  id: string;
  organization_id: string;
  session_id: string;
  token: string;
  scope: "public" | "org";
  created_by: string | null;
  created_at: string;
};

export type Approval = Timestamps & {
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

export type TaskEvent = {
  id: string;
  organization_id: string;
  task_id: string | null;
  event_type: string;
  agent: AgentKey | null;
  hub: Hub | null;
  payload: Json;
  created_at: string;
}

export type MarketplaceListing = Timestamps & {
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
  // Structured deal-card fields (migration 0011)
  target_irr: number | null;
  hold_period_years: number | null;
  geography: string | null;
  asset_class: string | null;
  teaser_url: string | null;
}

export type MarketplaceInterest = {
  id: string;
  listing_id: string;
  organization_id: string;
  user_id: string;
  created_at: string;
}

export type TrackRecord = Timestamps & {
  id: string;
  organization_id: string;
  deal_name: string;
  asset_class: string | null;
  vintage_year: number | null;
  invested_amount: number | null;
  realized_value: number | null;
  unrealized_value: number | null;
  gross_irr: number | null;
  gross_moic: number | null;
  is_realized: boolean;
  notes: string | null;
};

export type DocumentStatus = "draft" | "review" | "ready";

export type Document = {
  id: string;
  organization_id: string;
  deal_id: string | null;
  asset_id: string | null;
  name: string;
  doc_type: string | null;
  storage_key: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  content: string | null;
  sort_order: number;
  status: DocumentStatus;
  created_at: string;
};

export type DocumentVersion = {
  id: string;
  document_id: string;
  organization_id: string;
  content: string | null;
  name: string;
  saved_by: string | null;
  created_at: string;
};

export type NdaSignature = {
  id: string;
  share_id: string;
  organization_id: string;
  signer_name: string;
  signer_email: string | null;
  signed_at: string;
  ip_hint: string | null;
};

export type DataRoomShare = {
  id: string;
  organization_id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
  // Phase 1 gate fields
  require_email: boolean;
  require_nda: boolean;
  nda_text: string | null;
  password_hash: string | null;
  // LP notification fields
  recipient_email: string | null;
  notify_on_open: boolean;
  // Selective sharing — null = full data room, array = only these section keys
  allowed_sections: string[] | null;
};

export type DataRoomView = {
  id: string;
  organization_id: string;
  share_id: string | null;
  document_id: string | null;
  kind: "room" | "document";
  created_at: string;
  // Phase 2 engagement fields
  viewer_email: string | null;
  duration_seconds: number | null;
  session_id: string | null;
};

export type InvestorPortalShare = {
  id: string;
  organization_id: string;
  investor_id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type InvestorPortalView = {
  id: string;
  organization_id: string;
  share_id: string | null;
  created_at: string;
};

export type ValuationMark = {
  id: string;
  organization_id: string;
  asset_id: string;
  value: number;
  as_of: string;
  method: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type Canvas = {
  id: string;
  organization_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
};

export type CanvasElement = {
  id: string;
  canvas_id: string;
  organization_id: string;
  type: "sticky" | "text" | "shape" | "arrow" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  color: string;
  from_id?: string | null;
  to_id?: string | null;
  shape_kind?: string | null;
  created_by: string | null;
  updated_at: string;
};

// Network OS types (migration 20260702000200_network_os).
export type MeetingBrief = {
  id: string;
  organization_id: string;
  investor_id: string | null;
  created_by: string | null;
  meeting_title: string;
  meeting_at: string;
  attendees: string[];
  brief_content: Record<string, unknown>;
  source: string;
  external_event_id: string | null;
  generated_at: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StrengthLabel = "cold" | "warm" | "active" | "strong";

export type NetworkContact = {
  id: string;
  organization_id: string;
  imported_by: string | null;
  first_name: string;
  last_name: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  title: string | null;
  company: string | null;
  company_domain: string | null;
  location: string | null;
  seniority: string | null;
  department: string | null;
  connected_on: string | null;
  source: string;
  relationship_owner: string | null;
  strength_score: number;
  strength_label: StrengthLabel;
  strength_updated_at: string | null;
  apollo_id: string | null;
  confidence: number;
  verified: boolean;
  enriched_at: string | null;
  notes: string | null;
  tags: string[];
  pooled: boolean;
  created_at: string;
  updated_at: string;
};

export type NetworkImportJob = {
  id: string;
  organization_id: string;
  created_by: string | null;
  source: string;
  status: string;
  total_rows: number;
  imported_rows: number;
  enriched_rows: number;
  failed_rows: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type IntroRequest = {
  id: string;
  organization_id: string;
  requested_by: string | null;
  target_contact_id: string | null;
  target_name: string;
  target_company: string | null;
  intro_path: string[];
  introducer_name: string | null;
  draft_message: string | null;
  status: string;
  sent_via: string | null;
  sent_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SyndicateCircle = {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  invite_code: string | null;
  is_active: boolean;
  member_count: number | null;
  created_at: string;
  updated_at: string;
};

export type CircleMembership = {
  id: string;
  circle_id: string;
  organization_id: string;
  user_id: string | null;
  role: string;
  share_network: boolean;
  joined_at: string;
};

export type ContactList = {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
};

export type ContactListMember = {
  id: string;
  list_id: string;
  contact_id: string;
  added_at: string;
};

export type Prompt = {
  id: string;
  organization_id: string;
  principal_id: string;
  body: string;
  parsed_intent: Json | null;
  routed_hub: Hub | null;
  routed_agent: AgentKey | null;
  created_at: string;
};

export type TaskHandoff = {
  id: string;
  organization_id: string;
  task_id: string;
  from_agent: AgentKey | null;
  to_agent: AgentKey;
  reason: string | null;
  payload: Json;
  created_at: string;
};

export type Automation = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  prompt: string;
  trigger_type: TriggerType;
  schedule: string | null;
  trigger_config: Json;
  auto_approve: boolean;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  run_count: number;
  created_by: string | null;
  canvas_json?: Json | null;
};

// A persisted Mandate (migration 0029) — the operator's standing delegation
// that the gate layer consumes. Named MandateRow to avoid clashing with the
// gate-layer `Mandate` interface in lib/gates.ts. `auto_approve` stores
// ActionKind values; `autonomy_ceiling` is capped at 2 in the DB (Tier 3 is
// never delegable).
export type MandateRow = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  goal: string | null;
  /** Covers which hubs, counterparty classes, deal sizes this mandate applies to. */
  scope: string | null;
  auto_approve: string[];
  autonomy_ceiling: number;
  /** Ordered list of {rule: string} constraints Earn must respect during execution. */
  guardrails: Array<{ rule: string }>;
  /** Hard limits on automated footprint: max outreach/day, dollar thresholds, etc. */
  blast_radius_rules: Record<string, unknown>[];
  is_active: boolean;
  created_by: string | null;
};

// An append-only dispatch audit row (migration 0030) — one record per action
// dispatched through lib/integrations. Mirrors the DispatchResult fields the
// integration layer returns. No `updated_at`: the ledger is never mutated, so
// it uses an explicit `created_at` rather than the Timestamps pair.
export type DispatchLog = {
  id: string;
  organization_id: string;
  task_id: string | null;
  action: string;
  channel: string;
  live: boolean;
  ok: boolean;
  detail: string | null;
  reference: string | null;
  created_by: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  organization_id: string | null;
  principal_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_state: Json | null;
  after_state: Json | null;
  ip_address: string | null;
  created_at: string;
};

// The Source learning ledger (migration 0041). One append-only row per operator
// action on an AI suggestion (accept / reject / queue). lib/source-intelligence
// distills these — per org and per principal — into the learned-preferences
// digest injected into Source prompts.
export type SourceFeedback = {
  id: string;
  organization_id: string;
  principal_id: string | null;
  module: string;
  agent: string | null;
  signal: string; // 'accepted' | 'rejected' | 'queued'
  subject_name: string;
  category: string | null;
  rationale: string | null;
  source_query: string | null;
  fit_score: number | null;
  action: string | null;
  record_id: string | null;
  task_id: string | null;
  session_id: string | null;
  metadata: Json;
  created_at: string;
};

export type OperatorFeedback = {
  id: string;
  organization_id: string;
  principal_id: string | null;
  scope: string | null;
  module: string | null;
  agent: string | null;
  signal: string;
  subject: string;
  task_id: string | null;
  team_task_id: string | null;
  session_id: string | null;
  metadata: Json;
  created_at: string;
};

// A Unified Inbox thread (migration 0038) — one counterparty touchpoint with an
// AI triage layer (priority/intent/ai_summary) and deep links into Command
// Center context (deal_id / investor_id). The inbound counterpart to DispatchLog.
export type InboxThread = Timestamps & {
  id: string;
  organization_id: string;
  channel: InboxChannel;
  category: InboxCategory;
  subject: string;
  counterparty_name: string | null;
  counterparty_email: string | null;
  preview: string | null;
  status: InboxThreadStatus;
  unread: boolean;
  priority: number;
  intent: string | null;
  ai_summary: string | null;
  last_message_at: string | null;
  meeting_at: string | null;
  meeting_url: string | null;
  deal_id: string | null;
  investor_id: string | null;
  created_by: string | null;
  // Optional teammate (principal) the thread is routed to (migration 20260702000016).
  assigned_to: string | null;
  // When a snoozed thread should auto-return to open (migration 20260702000017).
  snoozed_until: string | null;
};

// One message within an inbox thread (migration 0038).
export type InboxMessage = {
  id: string;
  organization_id: string;
  thread_id: string;
  direction: InboxDirection;
  author: string | null;
  body: string;
  occurred_at: string;
  metadata: Json;
  created_at: string;
};

// Ownership & Buyer Intelligence (migration 0056). The M&A side of the market on
// top of the sourcing catalog (0042) + deals: who-bought-whom history and the
// likely-buyer / add-on lists ranked by lib/ownership-intel.ts. Both org-scoped.
export type Acquisition = {
  id: string;
  organization_id: string;
  acquirer_name: string;
  target_name: string;
  acquirer_entity_id: string | null;
  target_entity_id: string | null;
  announced_on: string | null;
  price_amount: number | null;
  currency: string;
  structure: string | null; // 'majority' | 'minority' | 'add_on' | 'merger' | 'asset' | 'recap'
  sector: string | null;
  source_url: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
};

export type BuyerProfile = {
  id: string;
  organization_id: string;
  name: string;
  entity_id: string | null;
  buyer_type: string | null; // 'strategic' | 'financial' | 'pe' | 'family_office' | 'search_fund'
  thesis: string | null;
  sectors: string[];
  geographies: string[];
  check_min: number | null;
  check_max: number | null;
  appetite: number | null;
  source_url: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
};

// The Sourcing Intelligence catalog (migration 0042). A first-party, embedded
// entity store powering semantic discovery + lookalike search. `embedding` is the
// pgvector column surfaced as the text literal "[..]" the client sends; cosine
// search runs through the match_sourcing_entities RPC.
export type SourcingEntity = Timestamps & {
  id: string;
  organization_id: string;
  kind: string; // 'company' | 'investor' | 'fund' | 'advisor' | 'lender' | 'provider'
  name: string;
  domain: string | null;
  description: string | null;
  categories: string[];
  geography: string | null;
  metadata: Json;
  provenance: string; // 'manual' | 'ai' | 'web' | 'pipeline' | '<provider>'
  source_url: string | null;
  embedding: string | null;
  created_by: string | null;
};

// Outbound Outreach Sequences (migration 0060) — multi-touch cadences built on
// the gate + dispatch layer. A sequence has ordered steps; targets are enrolled
// and advanced one due step at a time, each send routed through the gate
// (queueSourceAction → gateDecision → dispatch), with the gate task recorded on
// the enrollment.
export type OutreachSequence = Timestamps & {
  id: string;
  organization_id: string;
  org_id?: string;
  name: string;
  channel?: string;
  audience?: string | null;
  status?: string;
  metadata?: Json;
  steps?: Json;
  stop_on_reply?: boolean;
  active?: boolean;
  created_by: string | null;
};

export type OutreachStep = {
  id: string;
  organization_id: string;
  sequence_id: string;
  step_order: number;
  delay_days: number;
  subject: string | null;
  body: string | null;
  action: string; // an ActionKind label from lib/gates
  metadata: Json;
  created_at: string;
};

export type OutreachEnrollment = Timestamps & {
  id: string;
  organization_id: string;
  sequence_id: string;
  subject_name: string;
  subject_email: string | null;
  subject_phone?: string | null;
  subject_role?: string | null;
  entity_id: string | null;
  current_step: number;
  status: string; // 'active' | 'completed' | 'replied' | 'stopped'
  last_sent_at: string | null;
  task_id: string | null;
  metadata: Json;
  created_by: string | null;
};

// An operator's verdict on a Source Radar recommendation (migration 0061). The
// learning loop: each accepted/dismissed/snoozed row, keyed by the
// (entity_kind, move_kind) it was shown for, feeds lib/radar-learning.ts which
// tunes future rankings. Append-style; created_at only.
export type RadarFeedback = {
  id: string;
  organization_id: string;
  entity_id: string | null;
  entity_name: string | null;
  entity_kind: string | null;
  move_kind: string | null; // RadarMoveKind: pipeline|buyers|outreach|signals|research
  action: string; // 'accepted' | 'dismissed' | 'snoozed'
  score_at_action: number | null;
  principal_id: string | null;
  created_at: string;
};

// A market signal / trigger about a catalog entity (migration 0055). The
// Signals & Triggers layer: discrete, time-stamped events (funding rounds,
// hiring, ownership changes, news, growth, raise/sale intent) that
// lib/sourcing-signals.ts rolls into a deterministic propensity score.
// `entity_id` is the sourcing_entities row when known (nullable); subject_name +
// kind keep the row self-describing. Append-style; created_at only.
export type EntitySignal = {
  id: string;
  organization_id: string;
  entity_id: string | null;
  subject_name: string;
  kind: string | null; // the entity kind, when known
  // 'funding_round' | 'hiring' | 'ownership_change' | 'news' | 'growth' |
  // 'raise_intent' | 'sale_intent'
  signal_type: string;
  strength: number; // 0–100
  summary: string | null;
  source_url: string | null;
  occurred_at: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
};

// Per-org, per-channel delivery settings for the Act-now Radar digest (migration
// 0062). One row per (organization_id, channel): where the ranked sourcing brief
// lands, how often, and at what minimum score.
export type RadarDigestPref = {
  id: string;
  organization_id: string;
  channel: string; // 'in_app' | 'slack' | 'email'
  recipient: string | null; // slack channel id / email; null for in_app
  cadence: string; // 'daily' | 'weekly'
  min_score: number;
  enabled: boolean;
  created_at: string;
};

// An append-only record of each Act-now Radar digest sent (migration 0062):
// which channel, how many items, and a compact snapshot of the top items.
export type RadarDigestLogEntry = {
  id: string;
  organization_id: string;
  channel: string;
  item_count: number;
  top_items: Json;
  sent_at: string;
};

// An append-only weekly snapshot of the serialized Source Outcome Funnel
// (migration 0065). `snapshot` holds the full Funnel (lib/source-funnel.ts);
// the most recent prior row is the baseline the weekly rollup diffs against.
export type FunnelSnapshotRow = {
  id: string;
  organization_id: string;
  snapshot: Json;
  captured_at: string;
};

// One implicit digest-engagement event (migration 0064): an operator opened a
// digest or clicked a row. Folded into the Radar learning loop as implicit
// feedback (clicks > opens, both weaker than an explicit accept).
export type RadarDigestEngagement = {
  id: string;
  organization_id: string;
  digest_log_id: string | null;
  entity_id: string | null;
  entity_name: string | null;
  entity_kind: string | null;
  move_kind: string | null;
  action: string; // 'opened' | 'clicked'
  occurred_at: string;
};

// One subject-line A/B assignment for an Act-now Radar digest send (migration
// 20260623120000): the variant a given radar_digest_log row was sent with.
// Joined to radar_digest_engagement via digest_log_id to learn which subject
// variant drives more opens/clicks, so the winner can be preferred.
export type DigestExperimentVariant = {
  id: string;
  organization_id: string;
  digest_log_id: string | null;
  experiment_key: string; // 'subject_line'
  variant: string; // e.g. 'control' | 'urgent' | 'curiosity'
  assigned_at: string;
};

export type Artifact = Timestamps & {
  id: string;
  organization_id: string;
  workflow_id: string | null;
  step_id: string | null;
  deal_id: string | null;
  title: string;
  artifact_type: ArtifactType;
  agent: AgentKey | null;
  hub: Hub | null;
  content: string;
  metadata: Json;
  created_by: string | null;
  // Trust layer (migration 0061). Provenance + verification mirror RecordMeta;
  // `sources` holds the grounding citations ({ source, snippet, score, kind }[])
  // and `brain_run_id` links to the reasoning that produced the output.
  provenance: string; // 'ai' | 'manual' | 'import'
  verification_status: string; // 'unverified' | 'verified'
  verified_at: string | null;
  verified_by: string | null;
  verification_note: string | null;
  sources: Json;
  brain_run_id: string | null;
  // Trust layer (migration 0066). Automated grounding score in [0,1] — how much
  // of the output reflects its cited sources.
  grounding_score: number;
};

// The cron-run ledger (migration 20260623160000). Last-run tracking for the
// three scheduled entrypoints — 'cron' (hourly), 'digest' (daily),
// 'digest_weekly' (weekly). An org-agnostic OPS table: written only by the
// service role at the end of each cron run, readable by any authenticated
// principal (no organization_id — the sweeps span every org). `detail` holds a
// small per-run summary (counts).
export type CronRun = {
  id: string;
  job: string;
  status: string;
  detail: Json | null;
  started_at: string | null;
  finished_at: string;
};

// Minimal Database shape compatible with @supabase/supabase-js generics.
// The Brain layer (migration 0023). brain_runs is the audit + session-
// visualization log of every Brain activation; brain_documents holds the inline
// source text a Brain reasons over.
export type BrainRun = {
  id: string;
  organization_id: string;
  session_id: string | null;
  brain_key: string;
  goal: string;
  autonomy_mode: string;
  status: string;
  input: Json | null;
  output: Json | null;
  tools_used: string[] | null;
  reasoning: string | null;
  created_by: string | null;
  created_at: string;
};

export type BrainDocument = {
  id: string;
  organization_id: string;
  session_id: string | null;
  name: string;
  doc_type: string | null;
  content: string;
  created_by: string | null;
  created_at: string;
};

// The Brain knowledge-base corpus (migration 0024). A SHARED, non-org-scoped
// reference store: each Brain's KB (lib/brains/knowledge/<brain_key>.md) chunked
// + embedded into pgvector. `embedding` is the pgvector column, surfaced as the
// text literal "[..]" the client sends; cosine search runs through the
// match_brain_kb_chunks RPC.
export type BrainKbChunk = {
  id: string;
  brain_key: string;
  source: string;
  chunk_index: number;
  content: string;
  embedding: string | null;
  created_at: string;
};

// Gift Earn (migration 0039). A shareable referral code per org; the referral
// forest (each org referred at most once, so referrer edges form a downline
// tree); an append-only credit ledger recording every credit movement; and
// purchased credit gifts redeemable by token.
export type ReferralCode = {
  id: string;
  organization_id: string;
  code: string;
  created_by: string | null;
  created_at: string;
};

export type Referral = {
  id: string;
  referrer_organization_id: string;
  referred_organization_id: string;
  code: string;
  status: "pending" | "joined" | "subscribed";
  created_at: string;
};

export type CreditLedgerEntry = {
  id: string;
  organization_id: string;
  amount: number;
  reason: string;
  source_organization_id: string | null;
  level: number | null;
  note: string | null;
  created_at: string;
};

export type CreditGift = {
  id: string;
  sender_organization_id: string;
  recipient_email: string;
  credits: number;
  amount_usd: number;
  message: string | null;
  status: "pending" | "redeemed" | "cancelled";
  redeem_token: string;
  redeemed_by_organization_id: string | null;
  created_by: string | null;
  created_at: string;
  redeemed_at: string | null;
};

// A FundExecs-issued API credential pair (migration 0044). The publishable key
// is public; only a keyed HMAC-SHA256 of the secret is stored, alongside
// non-secret display fragments (`secret_prefix` + `secret_last4`) so the UI can
// render a masked form. `mode` separates test from live credentials.
export type ApiKeyMode = "test" | "live";

export type ApiKey = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  mode: ApiKeyMode;
  publishable_key: string;
  secret_hash: string;
  secret_prefix: string;
  secret_last4: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
};

// A third-party secret an org stores for FundExecs to use on its behalf
// (migration 0044). The value is AES-256-GCM encrypted at rest; `last4` is the
// only plaintext fragment kept, for a recognizable masked display.
export type OrgSecret = Timestamps & {
  id: string;
  organization_id: string;
  provider: string;
  label: string | null;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  last4: string;
  created_by: string | null;
};

// Stripe hosted-Checkout session tracking (migration 0043). One row per Checkout
// Session, flipped to 'fulfilled' exactly once so credits/plan/gift effects are
// never double-applied. `metadata` mirrors the session metadata used to fulfill.
export type StripeCheckout = {
  id: string;
  organization_id: string;
  session_id: string;
  kind: "plan" | "pack" | "gift";
  status: "pending" | "fulfilled" | "cancelled";
  amount_usd: number | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  fulfilled_at: string | null;
};

// A shareable teaser of a deal (migration 0046): the public token + Earn's
// confidential memo. The full deal room is never exposed — only this travels.
export type DealShare = Timestamps & {
  id: string;
  organization_id: string;
  deal_id: string;
  token: string;
  memo: string;
  created_by: string | null;
  revoked_at: string | null;
};

// A matched (or forwarded) target of a shared deal (migration 0046). The
// recipient org reads these as its "deals that fit you" feed; `investor_id` is
// the recipient's own profile the deal fit, so the deep link resolves for them.
export type DealShareRecipient = {
  id: string;
  share_id: string;
  organization_id: string;
  investor_id: string | null;
  score: number;
  rationale: Json;
  source: "matched" | "forwarded";
  created_at: string;
};

// One view of a tracked deal-share link (migration 0046). `organization_id` is
// the sharer (who reads the access log); `viewer_org_id` is the viewing org
// when known, else null for an anonymous open.
export type DealShareView = {
  id: string;
  share_id: string;
  organization_id: string;
  viewer_org_id: string | null;
  viewer_label: string | null;
  created_at: string;
};

// One per-org integration connection brokered by the unified "merge gateway"
// (migration 0052). `status` 'revoked' explicitly overrides any env-level
// default. No secrets: `account_ref` is an opaque handle the gateway resolves.
export type IntegrationConnectionStatus = "connected" | "revoked";
export type IntegrationConnection = {
  id: string;
  organization_id: string;
  channel: string;
  status: IntegrationConnectionStatus;
  gateway: string;
  account_label: string | null;
  account_ref: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

// A persisted conversational turn in a session (migration 0053). 'user' is the
// operator's message, 'assistant' is Earn's reply; `model` records the style
// engine for assistant turns. Advisory/ungated — no approval state.
export type SessionMessage = {
  id: string;
  organization_id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  created_by: string | null;
  created_at: string;
};

// LP Onboarding Portal (migration 20260622100000). Tracks one LP through the
// onboarding flow (pending → accreditation → subscription → committed →
// complete). A unique token drives the public portal route. `wire_instructions`
// is free-form jsonb. Org-scoped.
export type LpOnboardingSession = Timestamps & {
  id: string;
  organization_id: string;
  investor_id: string | null;
  fund_id: string | null;
  token: string;
  status: string; // 'pending' | 'accreditation' | 'subscription' | 'committed' | 'complete' | 'expired'
  lp_name: string;
  lp_email: string;
  commitment_amount: number | null;
  accreditation_type: string | null; // 'accredited_investor' | 'qualified_purchaser' | 'qualified_client' | 'institutional'
  accreditation_verified_at: string | null;
  kyc_status: string; // 'pending' | 'in_progress' | 'verified' | 'failed'
  kyc_verified_at: string | null;
  docusign_envelope_id: string | null;
  subscription_signed_at: string | null;
  capital_received_at: string | null;
  wire_instructions: Json;
  notes: string | null;
  expires_at: string;
};

// A live contract instance (migration 20260622100000) — generated from a
// template or uploaded directly. `extracted_clauses` is free-form jsonb. Org-
// scoped.
export type Contract = Timestamps & {
  id: string;
  organization_id: string;
  template_id: string | null;
  fund_id: string | null;
  deal_id: string | null;
  investor_id: string | null;
  created_by: string | null;
  title: string;
  document_type: string;
  status: string; // 'draft' | 'review' | 'sent' | 'signed' | 'active' | 'expired' | 'terminated'
  docusign_envelope_id: string | null;
  signed_at: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  renewal_alert_days: number;
  renewal_alerted_at: string | null;
  extracted_clauses: Json;
  file_url: string | null;
  file_size_bytes: number | null;
  notes: string | null;
};

// A deal intelligence signal (migration 0058) — an external market signal tagged
// by sector. Named DealSignalRow to avoid clashing with the `DealSignal` view
// model in lib/deal-intelligence.ts. Org-scoped; `created_at`/`updated_at` are
// defaulted but the table has no updated_at trigger here.
export type DealSignalRow = {
  id: string;
  organization_id: string;
  deal_id: string | null;
  source: string; // 'manual' | 'pitchbook' | 'crunchbase' | 'cbinsights' | 'sec_filing' | 'news' | 'ai_extracted'
  signal_type: string; // 'funding_round' | 'acquisition' | 'ipo' | 'bankruptcy' | 'exec_change' | 'partnership' | 'market_entry' | 'exit' | 'lp_activity' | 'regulatory'
  title: string;
  summary: string | null;
  sector: string | null;
  subsector: string | null;
  geography: string | null;
  company_name: string | null;
  deal_size_min: number | null;
  deal_size_max: number | null;
  deal_stage: string | null;
  relevance_score: number | null;
  thesis_match_score: number | null;
  source_url: string | null;
  published_at: string | null;
  read_at: string | null;
  saved_at: string | null;
  created_at: string;
  updated_at: string;
};

// A sector heatmap snapshot (migration 0058) — aggregated deal activity per
// sector/stage for a snapshot date. Org-scoped.
export type SectorHeatmapSnapshot = {
  id: string;
  organization_id: string;
  sector: string;
  stage: string;
  deal_count: number;
  total_value: number | null;
  avg_value: number | null;
  yoy_change_pct: number | null;
  activity_level: string; // 'low' | 'moderate' | 'high' | 'very_high'
  snapshot_date: string;
  created_at: string;
};

// --- Finance Engine — Phase 1 ledger core (migration 20260702220000) ---------
export type FinAccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type FinNormalSide = "debit" | "credit";
export type FinPeriodStatus = "open" | "closed" | "locked";
export type FinEntryStatus = "draft" | "posted" | "reversed" | "reversal" | "void";

export type FinEntity = Timestamps & {
  id: string;
  organization_id: string;
  name: string;
  base_currency: string;
  parent_entity_id: string | null;
  tax_jurisdiction: string | null;
};

export type FinLedger = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  code: string;
  currency: string;
  is_primary: boolean;
  entry_seq: number;
};

export type FinAccount = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  code: string;
  name: string;
  type: FinAccountType;
  normal_side: FinNormalSide;
  parent_account_id: string | null;
  is_control: boolean;
  is_active: boolean;
  currency: string | null;
};

export type FinPeriod = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  starts_on: string;
  ends_on: string;
  status: FinPeriodStatus;
  closed_by: string | null;
  closed_at: string | null;
};

export type FinFxRate = {
  organization_id: string;
  as_of: string;
  from_ccy: string;
  to_ccy: string;
  rate: number;
};

export type FinJournalEntry = Timestamps & {
  id: string;
  organization_id: string;
  ledger_id: string;
  entity_id: string;
  period_id: string;
  entry_no: number | null;
  entry_date: string;
  memo: string | null;
  source: string;
  source_ref: string | null;
  status: FinEntryStatus;
  reverses_entry_id: string | null;
  posted_by: string | null;
  posted_at: string | null;
  hash: string | null;
  created_by: string | null;
};

export type FinJournalLine = {
  id: string;
  organization_id: string;
  entry_id: string;
  account_id: string;
  line_no: number;
  currency: string;
  amount: number;
  base_amount: number;
  fx_rate: number;
  memo: string | null;
  created_at: string;
};

// --- Finance Engine — Phase 2 banking (migration 20260703100000) -------------
export type FinImportFormat = "csv" | "ofx" | "qif" | "camt";
export type FinImportStatus = "pending" | "staged" | "failed";
export type FinBankTxnStatus = "unmatched" | "suggested" | "matched" | "reconciled" | "ignored";
export type FinReconMatchKind = "auto" | "manual";
export type FinRuleMatchType = "contains" | "exact" | "regex";
export type FinRuleMatchField = "description" | "counterparty";

export type FinBankAccount = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  gl_account_id: string;
  name: string;
  institution: string | null;
  account_mask: string | null;
  currency: string;
  is_active: boolean;
};

export type FinBankImport = Timestamps & {
  id: string;
  organization_id: string;
  bank_account_id: string;
  format: FinImportFormat;
  filename: string | null;
  checksum: string | null;
  row_count: number;
  staged_count: number;
  duplicate_count: number;
  status: FinImportStatus;
  statement_start: string | null;
  statement_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  imported_by: string | null;
};

export type FinBankTransaction = Timestamps & {
  id: string;
  organization_id: string;
  bank_account_id: string;
  import_id: string | null;
  txn_date: string;
  value_date: string | null;
  amount: number;
  currency: string;
  description: string | null;
  counterparty: string | null;
  external_ref: string | null;
  running_balance: number | null;
  dedup_hash: string;
  status: FinBankTxnStatus;
  suggested_account_id: string | null;
  matched_entry_id: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
};

export type FinTxnRule = Timestamps & {
  id: string;
  organization_id: string;
  entity_id: string;
  name: string;
  priority: number;
  match_type: FinRuleMatchType;
  match_field: FinRuleMatchField;
  pattern: string;
  amount_min: number | null;
  amount_max: number | null;
  target_account_id: string;
  counterparty: string | null;
  is_active: boolean;
};

export type FinReconciliation = {
  id: string;
  organization_id: string;
  bank_account_id: string;
  bank_txn_id: string;
  entry_id: string;
  match_kind: FinReconMatchKind;
  matched_by: string | null;
  matched_at: string;
  created_at: string;
};

// Insert/Update use Partial for ergonomics until full generated types land.
type TableShape<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

// ── New tables added by platform feature optimization migrations ──────────────

export type Envelope = {
  id: string;
  organization_id: string;
  title: string;
  message: string | null;
  document_content: string | null;
  document_type: string;
  file_url: string | null;
  status: string;
  sent_at?: string | null;
  completed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  recipient_count?: number | null;
};

export type EnvelopeRecipient = {
  id: string;
  envelope_id: string;
  name: string;
  email: string;
  routing_order: number;
  signing_token: string;
  status: string;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  viewed_at?: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signature_data: string | null;
  initials_data: string | null;
  created_at: string;
};

export type EnvelopeField = {
  id: string;
  envelope_id: string;
  recipient_id: string;
  field_type: string;
  page: number;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  label: string | null;
  required: boolean;
  response: string | null;
  created_at: string;
};

export type EnvelopeEvent = {
  id: string;
  envelope_id: string;
  recipient_id: string | null;
  event_type: string;
  metadata: Json | null;
  created_at: string;
};

export type LiveMeeting = {
  id: string;
  room_code: string;
  title: string;
  host_id: string | null;
  organization_id: string | null;
  deal_id: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type LiveMeetingParticipant = {
  id: string;
  meeting_id: string;
  user_id: string | null;
  display_name: string;
  joined_at: string;
  left_at: string | null;
};

export type LiveMeetingTranscript = {
  id: string;
  meeting_id: string;
  speaker: string | null;
  text: string;
  ts: string;
};

export type LiveMeetingReport = {
  id: string;
  meeting_id: string;
  summary: string | null;
  key_points: Json;
  action_items: Json;
  full_transcript: string | null;
  analysis: Json | null;
  created_at: string;
};

export type AgentMemory = {
  id: string;
  org_id: string;
  agent_key: string;
  memory_type: string;
  content: string;
  source_task_id: string | null;
  source_session_id: string | null;
  pinned: boolean;
  dismissed: boolean;
  created_at: string;
};

export type PipelineStage = {
  id: string;
  org_id: string;
  hub: string;
  name: string;
  entry_conditions: Json;
  exit_criteria: Json;
  required_artifacts: string[];
  auto_actions: Json;
  order_index: number;
  created_at: string;
};

export type SequenceEnrollment = {
  id: string;
  sequence_id: string;
  target_type: string;
  target_id: string;
  current_step: number;
  enrolled_at: string;
  next_step_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  stopped_reason: string | null;
};

export type AlertRule = {
  id: string;
  org_id: string;
  name: string;
  trigger_entity: string;
  trigger_field: string;
  operator: string;
  threshold_value: string | null;
  channel: Json;
  escalation: Json;
  active: boolean;
  created_by: string | null;
  created_at: string;
};

export type AlertEvent = {
  id: string;
  rule_id: string;
  org_id: string;
  entity_type: string;
  entity_id: string | null;
  payload: Json | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
};

export type RoutingEvent = {
  id: string;
  task_id: string | null;
  org_id: string;
  agent_key: string;
  step_index: number | null;
  rationale_json: Json | null;
  confidence: number | null;
  created_at: string;
};

export type WorkflowTemplate = {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  canvas_json: Json;
  is_global: boolean;
  created_by: string | null;
  created_at: string;
};

export type SynthesisQueue = {
  id: string;
  org_id: string;
  topic_key: string;
  source_artifact_ids: Json;
  synthesis_status: string;
  draft_content: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Annotation = {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  author_id: string | null;
  content: string;
  position_json: Json | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      principals: TableShape<Principal>;
      organizations: TableShape<Organization>;
      organization_members: TableShape<OrganizationMember>;
      investment_theses: TableShape<InvestmentThesis>;
      track_records: TableShape<TrackRecord>;
      investors: TableShape<Investor>;
      funds: TableShape<Fund>;
      commitments: TableShape<Commitment>;
      capital_events: TableShape<CapitalEvent>;
      deals: TableShape<Deal>;
      assets: TableShape<Asset>;
      documents: TableShape<Document>;
      document_versions: TableShape<DocumentVersion>;
      underwritings: TableShape<Underwriting>;
      diligence_items: TableShape<DiligenceItem>;
      ic_decisions: TableShape<IcDecision>;
      conviction_snapshots: TableShape<ConvictionSnapshot>;
      relationships: TableShape<Relationship>;
      ai_agents: TableShape<AiAgent>;
      prompts: TableShape<Prompt>;
      tasks: TableShape<Task>;
      team_tasks: TableShape<TeamTask>;
      task_handoffs: TableShape<TaskHandoff>;
      approvals: TableShape<Approval>;
      task_events: TableShape<TaskEvent>;
      artifacts: TableShape<Artifact>;
      automations: TableShape<Automation>;
      mandates: TableShape<MandateRow>;
      dispatch_log: TableShape<DispatchLog>;
      audit_log: TableShape<AuditLog>;
      source_feedback: TableShape<SourceFeedback>;
      sourcing_entities: TableShape<SourcingEntity>;
      entity_signals: TableShape<EntitySignal>;
      acquisitions: TableShape<Acquisition>;
      buyer_profiles: TableShape<BuyerProfile>;
      operator_feedback: TableShape<OperatorFeedback>;
      session_groups: TableShape<SessionGroup>;
      sessions: TableShape<Session>;
      wallets: TableShape<Wallet>;
      session_shares: TableShape<SessionShare>;
      entities: TableShape<Entity>;
      partners: TableShape<Partner>;
      service_providers: TableShape<ServiceProvider>;
      debt_facilities: TableShape<DebtFacility>;
      marketplace_listings: TableShape<MarketplaceListing>;
      marketplace_interests: TableShape<MarketplaceInterest>;
      brain_runs: TableShape<BrainRun>;
      brain_documents: TableShape<BrainDocument>;
      brain_kb_chunks: TableShape<BrainKbChunk>;
      data_room_shares: TableShape<DataRoomShare>;
      data_room_views: TableShape<DataRoomView>;
      investor_portal_shares: TableShape<InvestorPortalShare>;
      investor_portal_views: TableShape<InvestorPortalView>;
      valuation_marks: TableShape<ValuationMark>;
      stakeholders: TableShape<Stakeholder>;
      share_classes: TableShape<ShareClass>;
      equity_holdings: TableShape<EquityHolding>;
      inbox_threads: TableShape<InboxThread>;
      inbox_messages: TableShape<InboxMessage>;
      referral_codes: TableShape<ReferralCode>;
      referrals: TableShape<Referral>;
      credit_ledger: TableShape<CreditLedgerEntry>;
      credit_gifts: TableShape<CreditGift>;
      stripe_checkouts: TableShape<StripeCheckout>;
      api_keys: TableShape<ApiKey>;
      org_secrets: TableShape<OrgSecret>;
      deal_shares: TableShape<DealShare>;
      deal_share_recipients: TableShape<DealShareRecipient>;
      deal_share_views: TableShape<DealShareView>;
      reputation_scores: TableShape<ReputationScore>;
      reputation_ledger: TableShape<ReputationLedgerEntry>;
      stake_positions: TableShape<StakePosition>;
      attestations: TableShape<Attestation>;
      stake_disputes: TableShape<StakeDispute>;
      integration_connections: TableShape<IntegrationConnection>;
      session_messages: TableShape<SessionMessage>;
      outreach_sequences: TableShape<OutreachSequence>;
      outreach_steps: TableShape<OutreachStep>;
      outreach_enrollments: TableShape<OutreachEnrollment>;
      radar_feedback: TableShape<RadarFeedback>;
      radar_digest_prefs: TableShape<RadarDigestPref>;
      radar_digest_log: TableShape<RadarDigestLogEntry>;
      funnel_snapshots: TableShape<FunnelSnapshotRow>;
      radar_digest_engagement: TableShape<RadarDigestEngagement>;
      digest_experiment_variants: TableShape<DigestExperimentVariant>;
      cron_runs: TableShape<CronRun>;
      lp_onboarding_sessions: TableShape<LpOnboardingSession>;
      contracts: TableShape<Contract>;
      deal_signals: TableShape<DealSignalRow>;
      sector_heatmap_snapshots: TableShape<SectorHeatmapSnapshot>;
      envelopes: TableShape<Envelope>;
      envelope_recipients: TableShape<EnvelopeRecipient>;
      envelope_fields: TableShape<EnvelopeField>;
      envelope_events: TableShape<EnvelopeEvent>;
      signing_envelopes: TableShape<Envelope>;
      signing_recipients: TableShape<EnvelopeRecipient>;
      signing_fields: TableShape<EnvelopeField>;
      signing_events: TableShape<EnvelopeEvent>;
      live_meetings: TableShape<LiveMeeting>;
      live_meeting_participants: TableShape<LiveMeetingParticipant>;
      live_meeting_transcripts: TableShape<LiveMeetingTranscript>;
      live_meeting_reports: TableShape<LiveMeetingReport>;
      agent_memories: TableShape<AgentMemory>;
      pipeline_stages: TableShape<PipelineStage>;
      sequence_enrollments: TableShape<SequenceEnrollment>;
      alert_rules: TableShape<AlertRule>;
      alert_events: TableShape<AlertEvent>;
      routing_events: TableShape<RoutingEvent>;
      workflow_templates: TableShape<WorkflowTemplate>;
      synthesis_queue: TableShape<SynthesisQueue>;
      annotations: TableShape<Annotation>;
      nda_signatures: TableShape<NdaSignature>;
      docusign_envelopes: TableShape<DocusignEnvelope>;
      canvases: TableShape<Canvas>;
      canvas_elements: TableShape<CanvasElement>;
      meeting_briefs: TableShape<MeetingBrief>;
      network_contacts: TableShape<NetworkContact>;
      network_import_jobs: TableShape<NetworkImportJob>;
      intro_requests: TableShape<IntroRequest>;
      syndicate_circles: TableShape<SyndicateCircle>;
      circle_memberships: TableShape<CircleMembership>;
      contact_lists: TableShape<ContactList>;
      contact_list_members: TableShape<ContactListMember>;
      fin_entities: TableShape<FinEntity>;
      fin_ledgers: TableShape<FinLedger>;
      fin_accounts: TableShape<FinAccount>;
      fin_periods: TableShape<FinPeriod>;
      fin_fx_rates: TableShape<FinFxRate>;
      fin_journal_entries: TableShape<FinJournalEntry>;
      fin_journal_lines: TableShape<FinJournalLine>;
      fin_bank_accounts: TableShape<FinBankAccount>;
      fin_bank_imports: TableShape<FinBankImport>;
      fin_bank_transactions: TableShape<FinBankTransaction>;
      fin_txn_rules: TableShape<FinTxnRule>;
      fin_reconciliations: TableShape<FinReconciliation>;
    };
    Views: Record<string, never>;
    Functions: {
      // Atomically post a balanced journal entry: bump the ledger sequence,
      // insert the entry + lines in one transaction (migration 20260702220000).
      fin_post_journal_entry: {
        Args: {
          p_ledger: string;
          p_period: string;
          p_entry_date: string;
          p_memo: string | null;
          p_source: string | null;
          p_source_ref: string | null;
          p_reverses: string | null;
          p_lines: Json;
          p_actor: string | null;
        };
        Returns: string;
      };
      // Atomically apply a batch of (txn, entry) reconciliations: insert each
      // audit row and flip the bank txn to 'reconciled' in one transaction
      // (migration 20260703110000). Returns the count applied.
      fin_reconcile_txns: {
        Args: {
          p_pairs: Json;
          p_match_kind: FinReconMatchKind;
          p_actor: string | null;
        };
        Returns: number;
      };
      // Cosine-search a Brain's KB corpus (migration 0024). embedding args are
      // sent as the pgvector text literal "[0.1,0.2,...]".
      match_brain_kb_chunks: {
        Args: {
          query_embedding: string;
          target_brain_key: string;
          match_count?: number;
        };
        Returns: {
          id: string;
          brain_key: string;
          source: string;
          chunk_index: number;
          content: string;
          similarity: number;
        }[];
      };
      // Atomically credit an org's wallet AND append a ledger row in one
      // transaction (migration 20260701). Returns the new balance.
      grant_org_credits: {
        Args: {
          p_org: string;
          p_delta: number;
          p_reason: string;
          p_source_org?: string | null;
          p_level?: number | null;
          p_note?: string | null;
        };
        Returns: number;
      };
      // Atomically credit an org's wallet (creating it if absent), clamped at 0
      // (migration 0039). Returns the new balance.
      increment_org_credits: {
        Args: {
          p_org: string;
          p_delta: number;
        };
        Returns: number;
      };
      // Cosine-search the org's Sourcing Intelligence catalog (migration 0042).
      // embedding sent as the pgvector text literal "[0.1,0.2,...]".
      match_sourcing_entities: {
        Args: {
          query_embedding: string;
          target_org: string;
          match_count?: number;
          filter_kind?: string | null;
          exclude_id?: string | null;
        };
        Returns: {
          id: string;
          kind: string;
          name: string;
          domain: string | null;
          description: string | null;
          categories: string[];
          geography: string | null;
          metadata: Json;
          source_url: string | null;
          provenance: string;
          similarity: number;
        }[];
      };
      // Atomically add to an org's reputation score (creating the row if absent),
      // clamped at 0 (migration 0048). Returns the new score.
      increment_org_reputation: {
        Args: {
          p_org: string;
          p_delta: number;
        };
        Returns: number;
      };
    };
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
      artifact_type: ArtifactType;
      marketplace_status: MarketplaceStatus;
      trigger_type: TriggerType;
      session_origin: SessionOrigin;
      inbox_channel: InboxChannel;
      inbox_category: InboxCategory;
      inbox_thread_status: InboxThreadStatus;
      inbox_direction: InboxDirection;
      fin_account_type: FinAccountType;
      fin_normal_side: FinNormalSide;
      fin_period_status: FinPeriodStatus;
      fin_entry_status: FinEntryStatus;
      fin_import_format: FinImportFormat;
      fin_import_status: FinImportStatus;
      fin_bank_txn_status: FinBankTxnStatus;
      fin_recon_match_kind: FinReconMatchKind;
      fin_rule_match_type: FinRuleMatchType;
      fin_rule_match_field: FinRuleMatchField;
    };
  };
}
