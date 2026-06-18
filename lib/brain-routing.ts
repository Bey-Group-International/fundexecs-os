// Agent → Brain routing.
//
// The task engine plans a workflow into steps, each delegated to an AgentKey.
// Brains EXECUTE: every executed step is additionally attributed to a Brain so
// the work is logged to brain_runs and surfaces in the session "Brains at work"
// theater. This table maps each delegating agent to the specialized Brain that
// best matches its role.
import type { AgentKey } from "@/lib/supabase/database.types";
import type { BrainKey } from "@/lib/brains";

export const AGENT_TO_BRAIN: Record<AgentKey, BrainKey> = {
  analyst: "deal_sourcer",
  associate: "earnest_fundmaker",
  investor_relations: "executive_advisor",
  portfolio_ops: "capital_connector",
  diligence: "legal_admin",
  fund_admin: "legal_admin",
};

export function brainForAgent(agent: AgentKey): BrainKey {
  return AGENT_TO_BRAIN[agent] ?? "earnest_fundmaker";
}
