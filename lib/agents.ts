// The six native AI agents. Mirrors the seed data in
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
    capabilities: ["pro_forma", "valuation", "sensitivity", "comps"],
  },
  {
    key: "associate",
    name: "Earn",
    hub: null,
    role: "Coordinates workflows and task execution across all hubs.",
    color: "#6366f1",
    motionStyle: "coordinated, rhythmic",
    capabilities: ["orchestration", "routing", "handoff", "task_management"],
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
    capabilities: ["kpis", "budgets", "capex", "variance"],
  },
  {
    key: "diligence",
    name: "Diligence",
    hub: "run",
    role: "Parses documents, flags risks, and produces diligence memos.",
    color: "#ef4444",
    motionStyle: "sharp, investigative",
    capabilities: ["doc_parsing", "risk_flags", "diligence_memo"],
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
];

export const AGENT_BY_KEY: Record<AgentKey, AgentDefinition> = Object.fromEntries(
  AGENTS.map((a) => [a.key, a]),
) as Record<AgentKey, AgentDefinition>;
