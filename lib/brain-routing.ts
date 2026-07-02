// Agent → Brain routing.
//
// The task engine plans a workflow into steps, each delegated to an AgentKey.
// Brains EXECUTE: every executed step is additionally attributed to a Brain so
// the work is logged to brain_runs and surfaces in the session "Brains at work"
// theater. This table maps each delegating agent to the specialized Brain that
// best matches its role.
import type { AgentKey } from "@/lib/supabase/database.types";
import type { BrainKey } from "@/lib/brains";
import type { EdgeContextResult } from "@/lib/edge-context";

export const AGENT_TO_BRAIN: Record<AgentKey, BrainKey> = {
  analyst: "deal_sourcer",
  associate: "earnest_fundmaker",
  investor_relations: "executive_advisor",
  portfolio_ops: "capital_connector",
  diligence: "legal_admin",
  fund_admin: "legal_admin",
  executive_advisor: "executive_advisor",
  capital_raiser: "earnest_fundmaker",
  capital_connector: "capital_connector",
  deal_sourcer: "deal_sourcer",
  rainmaker: "rainmaker",
  lead_generator: "funnel_lead_gen",
  pr_director: "marketing_pr",
  seo_disruptor: "seo_disrupter",
  curator: "event_curator",
};

export function brainForAgent(agent: AgentKey): BrainKey {
  return AGENT_TO_BRAIN[agent] ?? "earnest_fundmaker";
}

/**
 * Select the best-fit AgentKey for a given request, optionally biased by
 * edge context priority scores. The priority map from EdgeContextResult is
 * additive — it shifts the ranking among candidates but cannot select an
 * agent that wasn't already a plausible match for the workflow.
 *
 * candidates: ordered list of agents the task engine considers appropriate.
 * edgeContext: optional session browser context (does not override candidates).
 *
 * Returns the highest-scoring candidate after applying the context bias.
 */
export function selectAgentWithContext(
  candidates: AgentKey[],
  edgeContext?: EdgeContextResult
): AgentKey {
  if (!candidates.length) return "executive_advisor";
  if (!edgeContext || Object.keys(edgeContext.agentPriorityMap).length === 0) {
    return candidates[0];
  }

  const priorityMap = edgeContext.agentPriorityMap;

  // Score each candidate: base score from position (descending), plus
  // edge context bias (0-100). Position score ensures candidates the
  // task engine ranked first still win absent a strong context signal.
  const scored = candidates.map((agent, idx) => {
    const positionScore = (candidates.length - idx) * 10;
    const contextBias = priorityMap[agent] ?? 0;
    return { agent, score: positionScore + contextBias };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].agent;
}
