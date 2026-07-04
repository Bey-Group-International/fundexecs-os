"use server";

// components/agenda/actions.ts — gated Earn handoff for an agenda item.
//
// Routes a single dated obligation into Earn as a follow-up prompt: it opens a
// session and materializes a plan, but DOES NOT approve or execute anything.
// The standing approval loop gates every outward action, so this only surfaces
// "what Earn would do" and links the operator into the session to decide.
import { getSessionContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { createServerClient } from "@/lib/supabase/server";

export interface ChaseInput {
  title: string;
  kind: string;
  href: string;
}

export interface ChaseResult {
  ok: boolean;
  sessionId?: string;
  planTitle?: string;
  error?: string;
}

/** Hand one agenda item to Earn as a chase; returns the routed plan, ungated. */
export async function chaseAgendaItem(input: ChaseInput): Promise<ChaseResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

  const supabase = await createServerClient();

  try {
    const result = await handlePrompt(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      `Follow up on the upcoming obligation "${input.title}" (${input.kind}). ` +
        "Identify the owner, draft the chase, and propose next steps.",
    );
    return {
      ok: true,
      sessionId: result.session_id,
      planTitle: result.plan.title,
    };
  } catch {
    return { ok: false, error: "Earn couldn't pick that up right now." };
  }
}
