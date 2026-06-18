// The Brain layer — types.
//
// Architectural shift: Workflows ORCHESTRATE, Brains EXECUTE. A workflow step
// "activates" a Brain with a goal + context + allowed tools + constraints; the
// Brain decides which tools/modules to run to achieve the goal. Each Brain is a
// specialized executive with its own execution profile (skills, tools, memory,
// reasoning style, risk profile, data permissions).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// How much autonomy the operator grants a Brain run.
//  manual — approve every Brain output
//  semi   — approve only key decisions
//  auto   — run end-to-end
export type AutonomyMode = "manual" | "semi" | "auto";

export type BrainKey =
  | "earnest_fundmaker"
  | "automater_scrubber"
  | "executive_advisor"
  | "rainmaker"
  | "deal_sourcer"
  | "capital_connector"
  | "marketing_pr"
  | "funnel_lead_gen"
  | "seo_disrupter"
  | "legal_admin"
  | "event_curator";

// A tool/module a Brain is allowed to reach for. Real adapters (search, CRM,
// enrichment, vector retrieval) plug in behind this id later.
export interface ToolSpec {
  id: string;
  label: string;
}

// A Brain's execution profile — the "specialized executive" definition. Seeded
// from the BGI Brain library knowledge bases.
export interface BrainProfile {
  key: BrainKey;
  name: string;
  role: string;
  // When the OS should route to this Brain (master-workflow "Use when").
  useWhen: string[];
  // The standardized outputs this Brain produces.
  outputs: string[];
  // Tools/modules this Brain may use.
  tools: ToolSpec[];
  // Reasoning style + risk posture, applied to the system prompt.
  reasoningStyle: string;
  riskProfile: "low" | "medium" | "high";
  // Short, hand-written system preamble distilled from the Brain's knowledge
  // base. The full KB is retrieved into context only when relevant (keeps cost
  // down). See lib/brains/knowledge.
  systemPreamble: string;
}

// Context handed to a Brain on activation: who/where, plus the data surfaces it
// may read or write.
export interface BrainContext {
  supabase: SupabaseClient<Database>;
  orgId: string;
  userId: string | null;
  sessionId?: string | null;
}

// The goal + constraints a Workflow step hands a Brain.
export interface BrainGoal {
  objective: string;
  // Free-form context (prior step outputs, user inputs, session data).
  context?: string;
  // Inline documents the Brain should reason over (for the Diligence Brain).
  documents?: { name: string; content: string }[];
  autonomy?: AutonomyMode;
  // Subset of the Brain's tools it is allowed to use this run (defaults to all).
  allowedTools?: string[];
}

export type BrainRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed";

// The structured result of a Brain activation, also persisted to brain_runs.
export interface BrainResult {
  runId: string | null;
  brainKey: BrainKey;
  status: BrainRunStatus;
  output: string;
  toolsUsed: string[];
  reasoning: string;
}

// Server-action response shapes (kept here, outside the "use server" file, which
// may only export async functions).
export interface DiligenceResponse {
  ok: boolean;
  error?: string;
  brainName?: string;
  output?: string;
  toolsUsed?: string[];
  reasoning?: string;
}

export interface ClassifyResponse {
  ok: boolean;
  note?: string;
}
