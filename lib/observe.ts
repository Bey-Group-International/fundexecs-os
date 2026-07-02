// lib/observe.ts
// Post-execution quality observer for the agentic loop.
//
// After each step the engine calls observeOutput. If the output fails the
// quality gate, the observer re-runs the step with an alternate agent
// (reroute) up to MAX_RETRIES times. Auto-retry only happens in "auto"
// autonomy mode — semi and manual require operator judgement before a redo.
//
// Quality signals are intentionally simple and cheap:
//   1. Length gate  — empty or suspiciously short outputs indicate a failure.
//   2. Placeholder  — outputs that are literally the fallback stub text.
//
// A grounding-score check is NOT applied here because sources aren't
// available until after Brain attribution (which comes after this call).
// Grounding feeds the approval gate instead.

import type { AgentKey, Hub } from "@/lib/supabase/database.types";
import type { AutonomyMode } from "@/lib/brains/types";
import { executeStep } from "@/lib/claude";

export const OBSERVE_MIN_LENGTH = 60;
export const OBSERVE_MAX_RETRIES = 2;

// Conservative fallback phrase produced by fallbackStepOutput in lib/claude.ts.
const FALLBACK_STUB = "step output unavailable";

// Agents available per hub for rerouting. Conservative lists — only agents
// whose capabilities genuinely overlap so the retry produces comparable work.
const HUB_REROUTE: Record<Hub, AgentKey[]> = {
  build: ["associate", "analyst", "executive_advisor"],
  source: ["capital_raiser", "deal_sourcer", "rainmaker"],
  run: ["analyst", "diligence", "associate"],
  execute: ["capital_connector", "fund_admin", "portfolio_ops"],
};

function isLowQuality(output: string): boolean {
  const trimmed = output.trim();
  if (trimmed.length < OBSERVE_MIN_LENGTH) return true;
  if (trimmed.toLowerCase().includes(FALLBACK_STUB)) return true;
  return false;
}

function rerouteAgent(failedAgent: AgentKey, hub: Hub): AgentKey | null {
  const pool = HUB_REROUTE[hub] ?? [];
  const alt = pool.find((a) => a !== failedAgent);
  return alt ?? null;
}

export interface ObserveArgs {
  autonomy: AutonomyMode;
  hub: Hub;
  workflowTitle: string;
  agent: AgentKey;
  stepTitle: string;
  stepDescription: string;
  priorOutputs: string[];
  orgContext?: string;
  documentMode?: boolean;
}

export interface ObserveResult {
  output: string;
  agent: AgentKey;
  retryCount: number;
}

/**
 * Evaluate output quality and auto-retry with rerouting if below threshold.
 * Returns the best output seen across attempts along with the final agent
 * used and how many retries were needed.
 *
 * Only retries in "auto" mode — semi and manual pass through immediately
 * so the operator can decide whether to rerun the step.
 */
export async function observeOutput(
  initialOutput: string,
  args: ObserveArgs,
): Promise<ObserveResult> {
  // Non-auto modes: respect the autonomy boundary — no silent reruns.
  if (args.autonomy !== "auto") {
    return { output: initialOutput, agent: args.agent, retryCount: 0 };
  }

  let output = initialOutput;
  let agent = args.agent;
  let retries = 0;

  while (isLowQuality(output) && retries < OBSERVE_MAX_RETRIES) {
    const nextAgent = rerouteAgent(agent, args.hub);
    if (!nextAgent) break; // no alternate available

    retries += 1;
    agent = nextAgent;

    output = await executeStep({
      workflowTitle: args.workflowTitle,
      agent,
      stepTitle: args.stepTitle,
      stepDescription: args.stepDescription,
      priorOutputs: args.priorOutputs,
      orgContext: args.orgContext,
      documentMode: args.documentMode,
    });
  }

  return { output, agent, retryCount: retries };
}
