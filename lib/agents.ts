// The fifteen native AI agents. Mirrors the seed data in
// supabase/migrations/0011_seed_agents.sql. Used for client-side rendering
// (workspace avatars, agent badges) without a round-trip to the catalog table.
import type { AgentKey, Hub } from "./supabase/database.types";

export interface AgentDefinition {
  key: AgentKey;
  name: string;
  hub: Hub | null;
  role: string;
  color: string;
  motionStyle: string;
  capabilities: string[];
}

export const AGENTS: AgentDefinition[] = [
  {
    key: "analyst",
    name: "Analyst",
    hub: "run",
    role: "Ingests deal data, financials, and market comps; produces pro formas and valuations.",
    color: "#22d3ee",
    motionStyle: "precise, analytical",
    capabilities: ["pro_forma", "valuation", "sensitivity", "comps", "acquisition_scoring"],
  },
  {
    key: "associate",
    name: "Earn",
    hub: null,
    role: "Coordinates workflows and task execution across all hubs.",
    color: "#6366f1",
    motionStyle: "coordinated, rhythmic",
    capabilities: ["orchestration", "routing", "handoff", "task_management", "integration_planning"],
  },
  {
    key: "investor_relations",
    name: "Investor Relations",
    hub: "execute",
    role: "Manages LP communications, capital calls, and reporting.",
    color: "#f59e0b",
    motionStyle: "smooth, communicative",
    capabilities: ["lp_comms", "capital_calls", "reporting"],
  },
  {
    key: "portfolio_ops",
    name: "Portfolio Ops",
    hub: "execute",
    role: "Monitors asset KPIs, budgets, capex, and variance alerts.",
    color: "#22c55e",
    motionStyle: "grounded, operational",
    capabilities: ["kpis", "budgets", "capex", "variance", "disposition", "buyer_matching"],
  },
  {
    key: "diligence",
    name: "Diligence",
    hub: "run",
    role: "Parses documents, flags risks, and produces diligence memos.",
    color: "#ef4444",
    motionStyle: "sharp, investigative",
    capabilities: ["doc_parsing", "risk_flags", "diligence_memo", "integration_risk"],
  },
  {
    key: "fund_admin",
    name: "Fund Admin",
    hub: "execute",
    role: "Handles waterfall calculations, fund accounting, and audit prep.",
    color: "#cbd5e1",
    motionStyle: "structured, methodical",
    capabilities: ["waterfall", "fund_accounting", "audit_prep"],
  },
  {
    key: "executive_advisor",
    name: "Executive Advisor",
    hub: "source",
    role: "Researches investors, family offices, and strategic partners before first contact. Surfaces intelligence on motivations, portfolio fit, and ideal entry approach.",
    color: "#a855f7",
    motionStyle: "precise, strategic",
    capabilities: ["investor_research", "targeting", "relationship_intel", "first_contact"],
  },
  {
    key: "capital_raiser",
    name: "Capital Raiser",
    hub: "source",
    role: "Drives LP fundraising and capital formation campaigns. Manages the Founding Capital Circle, anchor LP pipeline, and high-trust investor rooms.",
    color: "#ec4899",
    motionStyle: "assertive, relationship-driven",
    capabilities: ["lp_fundraising", "capital_formation", "founding_circle", "investor_pipeline"],
  },
  {
    key: "capital_connector",
    name: "Capital Connector",
    hub: "source",
    role: "Secures deal financing and structures the capital stack. Identifies the right lender, equity partner, or structured capital source for each transaction.",
    color: "#14b8a6",
    motionStyle: "strategic, deal-minded",
    capabilities: ["deal_financing", "capital_stack", "lender_relations", "sponsor_finance", "lender_sourcing"],
  },
  {
    key: "deal_sourcer",
    name: "Deal Sourcer",
    hub: "source",
    role: "Identifies acquisition targets — underperforming, founder-owned, or transitioning businesses. Structures creative financing and positions BGI as the right buyer.",
    color: "#f97316",
    motionStyle: "sharp, acquisitive",
    capabilities: ["deal_flow", "acquisition_strategy", "seller_outreach", "creative_financing", "deal_discovery"],
  },
  {
    key: "rainmaker",
    name: "Rainmaker",
    hub: "source",
    role: "Converts high-value prospects into commitments. Qualifies investors, closes capital conversations, and moves serious people from interest to signed terms.",
    color: "#fbbf24",
    motionStyle: "direct, high-conviction",
    capabilities: ["prospect_conversion", "capital_closing", "qualification", "outreach_sequencing"],
  },
  {
    key: "lead_generator",
    name: "Lead Generator",
    hub: "build",
    role: "Builds and operates digital funnels that capture investors, business owners, operators, and connectors. Integrates CRM, forms, and automation into a measurable pipeline.",
    color: "#84cc16",
    motionStyle: "systematic, growth-oriented",
    capabilities: ["funnel_design", "lead_capture", "crm_integration", "campaign_ops"],
  },
  {
    key: "pr_director",
    name: "PR Director",
    hub: "build",
    role: "Produces investor materials, pitch decks, CIMs, executive summaries, and PR narratives. Positions BGI as an institutional, culturally distinct investment platform.",
    color: "#06b6d4",
    motionStyle: "polished, authoritative",
    capabilities: ["investor_materials", "pitch_decks", "cim", "brand_narrative", "pr"],
  },
  {
    key: "seo_disruptor",
    name: "SEO Disruptor",
    hub: "build",
    role: "Builds search authority and organic lead generation. Turns BGI content and thought leadership into category-defining visibility that attracts the right capital and deal flow.",
    color: "#8b5cf6",
    motionStyle: "aggressive, data-driven",
    capabilities: ["seo_strategy", "content_authority", "organic_leads", "category_creation"],
  },
  {
    key: "curator",
    name: "Curator",
    hub: "build",
    role: "Designs private investor rooms and capital formation salons. Curates the right people, experience, and follow-up to convert gatherings into durable capital relationships.",
    color: "#d946ef",
    motionStyle: "refined, experience-driven",
    capabilities: ["event_curation", "private_rooms", "rsvp_management", "post_event_conversion"],
  },
];

export const AGENT_BY_KEY: Record<AgentKey, AgentDefinition> = Object.fromEntries(
  AGENTS.map((a) => [a.key, a]),
) as Record<AgentKey, AgentDefinition>;
