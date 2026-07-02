// Tool dispatch layer: classify a step's intent and route to the appropriate
// integration adapter (Gmail, Calendly, Docusign). Falls back to null
// (text-generation) when no integration is available for the step.
//
// Integration availability is resolved per-org via the gateway layer —
// gateway rows in integration_connections win over the deploy-wide env
// fallback. This means a step routes to a live tool only when THIS org has
// connected that integration, not just because env vars are present.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AgentKey } from "@/lib/supabase/database.types";
import { dispatchAction } from "@/lib/integrations";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import type { DispatchContext } from "@/lib/integrations/types";

export type StepIntent =
  | "send_email"
  | "book_meeting"
  | "sign_document"
  | "query_data"
  | "draft_document"
  | "text_generation";

export interface DispatchResult {
  intent: StepIntent;
  output: string;
  tool_used: string | null;
  tool_result: Record<string, unknown> | null;
}

/**
 * Classify a step's intent from its title and description.
 * Deterministic — no API call needed.
 */
export function classifyStepIntent(stepTitle: string, stepDescription: string): StepIntent {
  const text = `${stepTitle} ${stepDescription}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));

  if (has("send email", "email to", "draft email", "outreach email", "lp email", "send outreach", "send update", "email investors", "email lps")) {
    return "send_email";
  }
  if (has("schedule meeting", "book meeting", "calendar invite", "set up call", "arrange call", "schedule call", "book call", "set meeting")) {
    return "book_meeting";
  }
  if (has("sign document", "execute subdoc", "subscription doc", "term sheet", "docusign", "send for signature", "request signature")) {
    return "sign_document";
  }
  if (has("query", "pull data", "fetch data", "retrieve", "look up")) {
    return "query_data";
  }
  if (has("draft", "write", "prepare", "create memo", "ic memo", "lp update", "report", "summary")) {
    return "draft_document";
  }
  return "text_generation";
}

/**
 * Format a dispatch result's output for storage as a step artifact.
 * Returns a markdown string regardless of whether a tool was called.
 */
export function formatDispatchOutput(result: DispatchResult): string {
  if (!result.tool_used || !result.tool_result) return result.output;

  const toolSection = `\n\n---\n**Tool executed:** ${result.tool_used}\n\`\`\`json\n${JSON.stringify(result.tool_result, null, 2)}\n\`\`\``;
  return result.output + toolSection;
}

/**
 * Attempt to dispatch a step to a real tool integration.
 * Returns null when no integration handles this intent — caller falls back
 * to text generation via executeStep.
 *
 * Availability is per-org: checks integration_connections in the DB and
 * falls back to the deploy-wide env configuration when no row exists.
 * Tier 3 (sign_document) only dispatches after operator approval — the gate
 * layer enforces this; we just route the request once it arrives here.
 */
export async function dispatchStepTool(args: {
  intent: StepIntent;
  stepTitle: string;
  stepDescription: string;
  workflowTitle: string;
  agent: AgentKey;
  orgContext: string;
  orgId: string;
  actorId?: string;
  supabase: SupabaseClient<Database>;
}): Promise<DispatchResult | null> {
  // Data queries are handled by Claude with org context injection — no
  // external API needed.
  if (args.intent === "query_data") return null;

  // Resolve which channels this org has connected.
  const connected = await orgConnectedChannels(args.supabase, args.orgId);

  const intentToChannel: Record<StepIntent, string | null> = {
    send_email: "gmail",
    // native_meeting generates a /meeting-room link — no external scheduling service needed.
    book_meeting: "native_meeting",
    sign_document: "docusign",
    query_data: null,
    draft_document: null,
    text_generation: null,
  };

  const channel = intentToChannel[args.intent];
  if (!channel) return null;

  const intentToAction = {
    send_email: "send_outreach" as const,
    book_meeting: "propose_meeting" as const,
    sign_document: "sign_document" as const,
  } satisfies Partial<Record<StepIntent, DispatchContext["action"]>>;

  const action = intentToAction[args.intent as keyof typeof intentToAction];
  if (!action) return null;

  // native_meeting is always connected (no integration_connections row needed).
  const isConnected = channel === "native_meeting" ? true : connected.has(channel);

  const ctx: DispatchContext = {
    orgId: args.orgId,
    actorId: args.actorId ?? "system",
    action,
    channel,
    connected: isConnected,
    subject: `${args.workflowTitle} — ${args.stepTitle}`,
    body: args.stepDescription.trim() + (args.orgContext ? `\n\n---\n${args.orgContext}` : ""),
    metadata: { stepTitle: args.stepTitle, workflowTitle: args.workflowTitle },
    supabase: args.supabase,
  };

  const result = await dispatchAction(ctx);

  return {
    intent: args.intent,
    output: result.detail,
    tool_used: result.live ? channel : null,
    tool_result: {
      ok: result.ok,
      channel: result.channel,
      live: result.live,
      detail: result.detail,
      ...(result.reference ? { reference: result.reference } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.gated ? { gated: result.gated } : {}),
    },
  };
}
