"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import {
  copilotContextFromPath,
  contextPreamble,
  suggestionsFor,
  type CopilotContext,
} from "@/lib/copilot";
import type { AgentKey } from "@/lib/supabase/database.types";

export interface AskEarnResult {
  ok: boolean;
  sessionId?: string;
  planTitle?: string;
  steps?: { agent: AgentKey; title: string }[];
  error?: string;
}

// Plan a free-form ask against the operator's current location. Returns a
// summary of the routed plan (which specialists Earn delegated to) for inline
// display in the dock, with a deep link into the full session. The standing
// approval loop still gates any outward action the plan proposes.
export async function askEarn(input: {
  body: string;
  pathname: string;
}): Promise<AskEarnResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

  const body = input.body.trim();
  if (!body) return { ok: false, error: "Ask Earn something first." };

  const location = copilotContextFromPath(input.pathname);
  const supabase = createServerClient();
  try {
    const result = await handlePrompt(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      `${contextPreamble(location)} ${body}`,
    );
    return {
      ok: true,
      sessionId: result.session_id,
      planTitle: result.plan.title,
      steps: result.plan.steps.map((s) => ({ agent: s.agent, title: s.title })),
    };
  } catch {
    return { ok: false, error: "Earn couldn't plan that just now. Try again." };
  }
}

function findSuggestionPrompt(loc: CopilotContext, id: string): string | null {
  return suggestionsFor(loc).find((s) => s.id === id)?.prompt ?? null;
}

// Launch a pre-baked, context-aware suggestion. Mirrors the draft-with-Earn
// pattern: plan the templated prompt, then open the session it created.
export async function launchCopilotSuggestion(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const pathname = String(formData.get("pathname") ?? "/");
  const id = String(formData.get("suggestion_id") ?? "");
  const loc = copilotContextFromPath(pathname);
  const prompt = findSuggestionPrompt(loc, id);
  if (!prompt) redirect("/workspace");

  const supabase = createServerClient();
  const result = await handlePrompt(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    `${contextPreamble(loc)} ${prompt}`,
  );
  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}
