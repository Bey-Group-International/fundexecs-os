"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";

export interface HandoffResult {
  ok: boolean;
  sessionId?: string;
  planTitle?: string;
  error?: string;
}

// Hand the portfolio's concentration picture to Earn, which routes it to the
// right specialist and proposes the next move. The standing approval loop still
// gates any outward action the plan proposes — nothing here is auto-approved.
export async function reviewConcentration(): Promise<HandoffResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };
  const supabase = await createServerClient();
  try {
    const result = await handlePrompt(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      "Review the held portfolio's concentration and single-asset exposure. " +
        "Flag the positions carrying the most risk and propose how to rebalance.",
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
