// Per-agent flat credit cost per task-engine step. Charged once before each
// step executes; the compounding discount (reputation + loyalty) is applied on
// top via effectiveStepCost so reputable orgs pay less.
//
// Calibrated so a Starter subscriber (500 cr/mo) can run ~8 full workflows
// before refilling; Pro (4 k/mo) ~65; Scale (15 k/mo) ~250.
import type { AgentKey } from "@/lib/supabase/database.types";
import { effectiveCost } from "@/lib/compounding";
import type { CompoundingProfile } from "@/lib/compounding";

const BASE_STEP_COST: Partial<Record<AgentKey, number>> = {
  analyst:            30, // heavy financial modeling & valuation
  diligence:          30, // document parsing + risk analysis
  fund_admin:         30, // waterfall / fund accounting
  executive_advisor:  25,
  capital_raiser:     25,
  capital_connector:  25,
  deal_sourcer:       25,
  rainmaker:          25,
  investor_relations: 20,
  portfolio_ops:      20,
  lead_generator:     20,
  pr_director:        20,
  seo_disruptor:      20,
  curator:            20,
  associate:          15, // orchestration / coordination only
};

const DEFAULT_STEP_COST = 25;

/** Base credit cost for one step executed by `agentKey`. */
export function stepCost(agentKey: AgentKey | string | null | undefined): number {
  if (!agentKey) return DEFAULT_STEP_COST;
  return BASE_STEP_COST[agentKey as AgentKey] ?? DEFAULT_STEP_COST;
}

/** Credit cost after applying the org's compounding discount. */
export function effectiveStepCost(
  agentKey: AgentKey | string | null | undefined,
  profile: CompoundingProfile,
): number {
  return effectiveCost(stepCost(agentKey), profile);
}
