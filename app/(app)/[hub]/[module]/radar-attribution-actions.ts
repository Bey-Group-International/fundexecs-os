"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildAttribution, type Attribution } from "@/lib/radar-attribution";

export interface AttributionResult {
  ok: boolean;
  attribution?: Attribution;
  error?: string;
}

// The loop-closing read: every ACCEPTED radar recommendation traced forward through
// the funnel stages it pointed at — contacted → replied → met → mandate — rolled up
// per move kind with the headline accepted → mandate conversion, so the operator sees
// which recommendations actually convert. Read-only over existing tables.
export async function loadAttribution(): Promise<AttributionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const attribution = await buildAttribution(supabase, auth.ctx.orgId);
  return { ok: true, attribution };
}
