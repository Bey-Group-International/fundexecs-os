// lib/intelligence/routing.ts
// The Earn → executive routing matrix for intelligence. Pure + tested.
//
// Earn stays the orchestrator; this module only decides WHICH specialist an
// actionable observation should go to, and WHAT follow-on the approval would
// authorize. It reuses the AgentKey bench (lib/agents.ts) and the gate tiers
// (lib/gates.ts) — it never invents a new agent taxonomy or a new gate.
//
// Two invariants the product spec fixes:
//   • External intelligence may initiate ANALYSIS, never final action. So the
//     follow-on ActionKind is always Tier 1 (internal) or Tier 2 (external-
//     facing, sign-off) — this module can NEVER emit a Tier-3 action. Tier 3 is
//     reached only later, by a human, through the normal gate.
//   • The routed agent is chosen by the DOMINANT relevance dimension, so the
//     specialist best placed to act owns it.

import type { AgentKey } from "@/lib/supabase/database.types";
import type { ActionKind, GateTier } from "@/lib/gates";
import { tierForAction } from "@/lib/gates";
import type { ExposureType, RelevanceDimensions } from "./types";

export interface RoutingDecision {
  agent: AgentKey;
  /** The outward action the eventual approval would authorize (never Tier 3). */
  sendAction: ActionKind;
  requiredTier: GateTier;
  reason: string;
}

// Each specialist's default intelligence follow-on. Internal-analysis roles get
// a Tier-1 action; outward-facing roles get their Tier-2 action so the gate
// correctly demands sign-off before anything reaches a counterparty.
const AGENT_ACTION: Record<AgentKey, ActionKind> = {
  analyst: "research",
  diligence: "research",
  portfolio_ops: "research",
  fund_admin: "research",
  investor_relations: "distribute_report",
  capital_raiser: "send_outreach",
  capital_connector: "send_outreach",
  deal_sourcer: "send_outreach",
  executive_advisor: "draft_memo",
  rainmaker: "send_outreach",
  lead_generator: "build_list",
  pr_director: "draft_memo",
  seo_disruptor: "research",
  curator: "draft_memo",
  associate: "research",
};

/** Which relationship exposure types indicate which relationship specialist. */
function relationshipAgent(exposureTypes: Set<ExposureType>): AgentKey {
  if (exposureTypes.has("lp")) return "investor_relations";
  if (exposureTypes.has("lender") || exposureTypes.has("capital_provider")) return "capital_connector";
  return "investor_relations";
}

/**
 * Route an assessment to a specialist + follow-on action. `exposureTypes` are
 * the exposure kinds this observation touches (used to disambiguate relationship
 * routing). Deterministic; the dominant dimension wins, ties broken by a fixed
 * severity order (regulatory → deal → portfolio → relationship → mandate).
 */
export function routeIntelligence(
  dimensions: RelevanceDimensions,
  exposureTypes: Set<ExposureType>,
): RoutingDecision {
  const {
    mandateRelevance,
    dealRelevance,
    portfolioRelevance,
    relationshipRelevance,
    regulatoryRelevance,
  } = dimensions;

  // Ordered candidates: (dimension score, agent, why). First max wins the tie by
  // this severity order — regulatory is checked first because it is the least
  // forgiving to miss.
  const candidates: Array<{ score: number; agent: AgentKey; reason: string }> = [
    { score: regulatoryRelevance, agent: "executive_advisor", reason: "Regulatory / policy exposure — strategic + compliance synthesis." },
    { score: dealRelevance, agent: "diligence", reason: "Deal-relevant — investigate implications for the live deal." },
    { score: portfolioRelevance, agent: "portfolio_ops", reason: "Portfolio exposure — evaluate operating impact and mitigation." },
    { score: relationshipRelevance, agent: relationshipAgent(exposureTypes), reason: "Relationship exposure — prepare affected-party messaging." },
    { score: mandateRelevance, agent: "deal_sourcer", reason: "Mandate / thesis-relevant — surface targets and sourcing angles." },
  ];

  let winner = candidates[0];
  for (const c of candidates) {
    if (c.score > winner.score) winner = c;
  }

  // Nothing cleared the floor — hand it to the Analyst for preliminary research.
  if (winner.score <= 0) {
    winner = { score: 0, agent: "analyst", reason: "No dominant exposure — Analyst summarizes evidence and researches." };
  }

  let sendAction = AGENT_ACTION[winner.agent];
  let requiredTier = tierForAction(sendAction);

  // Structural guarantee: an external signal never yields a Tier-3 follow-on.
  // If a mapping ever did, fall back to internal research.
  if (requiredTier === 3) {
    sendAction = "research";
    requiredTier = 1;
  }

  return { agent: winner.agent, sendAction, requiredTier, reason: winner.reason };
}
