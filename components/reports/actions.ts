"use server";

// Gated Earn handoff for the LP Report. Drafts (does NOT send) a quarterly LP
// update by routing a prompt into the Earn engine, which opens a session and
// plans the work. Sending is an external (Tier-2) action governed by the
// standing approval / mandate loop — we only DRAFT + route here.
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { handlePrompt } from "@/lib/engine";

export async function draftLpUpdate(input: {
  period: string;
}): Promise<{
  ok: boolean;
  sessionId?: string;
  planTitle?: string;
  error?: string;
}> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

  const supabase = createServerClient();
  try {
    const result = await handlePrompt(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      "Draft the " +
        input.period +
        " quarterly LP update email summarizing fund performance (TVPI/DPI/NAV), portfolio highlights, and capital activity. Prepare it for review before sending.",
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
