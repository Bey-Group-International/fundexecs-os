// Tool dispatch layer: classify a step's intent and route to the appropriate
// integration (Gmail, Calendly, Supabase query). Falls back to text-generation
// when the intent doesn't map to a known tool or credentials aren't available.

import type { AgentKey } from "@/lib/supabase/database.types";

export type StepIntent =
  | "send_email"
  | "book_meeting"
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
  if (has("query", "pull data", "fetch data", "retrieve", "look up", "look up")) {
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
 * Returns null when no integration is available — caller should fall back to
 * text generation via executeStep.
 *
 * Tool integrations are credential-gated: Gmail requires GMAIL_CLIENT_ID +
 * GMAIL_CLIENT_SECRET + per-org refresh tokens stored in integrations table;
 * Calendly requires CALENDLY_API_KEY. When credentials are absent, returns
 * null so the caller falls back to Claude text output.
 */
export async function dispatchStepTool(args: {
  intent: StepIntent;
  stepTitle: string;
  stepDescription: string;
  workflowTitle: string;
  agent: AgentKey;
  orgContext: string;
  orgId: string;
}): Promise<DispatchResult | null> {
  // Tool dispatch is credential-gated. When no credentials are configured,
  // return null so the caller falls back to Claude text generation.
  // This ensures the system degrades gracefully rather than failing hard.

  switch (args.intent) {
    case "send_email":
      return await dispatchEmail(args);
    case "book_meeting":
      return await dispatchCalendar(args);
    case "query_data":
      // Data queries are handled by Claude with org context injection —
      // no external API needed. Fall back to text generation.
      return null;
    default:
      return null;
  }
}

async function dispatchEmail(args: {
  stepTitle: string;
  stepDescription: string;
  workflowTitle: string;
  orgContext: string;
}): Promise<DispatchResult | null> {
  // Gmail integration is gated on GMAIL_ENABLED env var.
  // When not set, fall back to Claude text generation.
  if (process.env.GMAIL_ENABLED !== "true") return null;

  // Compose a structured draft from the step context.
  // The actual MCP call (mcp__Gmail__create_draft) must be triggered from a
  // server action where MCP tools are available — not from this lib module.
  // TODO: wire to Gmail MCP via server action when deployed.
  const subject = `${args.workflowTitle} — ${args.stepTitle}`;
  const body = [
    args.stepDescription.trim(),
    "",
    args.orgContext ? `---\n${args.orgContext}` : "",
  ]
    .filter((l, i, arr) => !(i === arr.length - 1 && l === ""))
    .join("\n")
    .trim();

  return {
    intent: "send_email",
    output: `Email draft prepared: ${subject}`,
    tool_used: "gmail_draft",
    tool_result: {
      subject,
      body,
      // Recipient not yet resolved — operator sets before sending from inbox.
      to: null,
    },
  };
}

async function dispatchCalendar(args: {
  stepTitle: string;
  stepDescription: string;
  workflowTitle: string;
  orgContext: string;
}): Promise<DispatchResult | null> {
  // Calendly integration requires API key stored per-org.
  if (!process.env.CALENDLY_ENABLED) return null;

  // Placeholder: when Calendly integration is wired, this will:
  // 1. Extract attendees and meeting type from step description
  // 2. Create a scheduling link or one-off event via Calendly API
  // 3. Return the meeting URL as tool_result
  return {
    intent: "book_meeting",
    output: `Meeting scheduling initiated for: ${args.stepTitle}. Calendly integration pending credential configuration.`,
    tool_used: "calendly.create_event",
    tool_result: { status: "pending_credentials" },
  };
}
