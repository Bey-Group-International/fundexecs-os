"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildFunnel, type Funnel } from "@/lib/source-funnel";

export interface FunnelResult {
  ok: boolean;
  funnel?: Funnel;
  error?: string;
}

// The measurement read: the sourcing suite tallied end-to-end —
// sourced → contacted → replied → met → mandate — with stage-to-stage
// conversion and a breakdown by source/provenance and signal type, so the
// operator sees what's actually converting. Read-only over existing tables.
export async function loadFunnel(): Promise<FunnelResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const funnel = await buildFunnel(supabase, auth.ctx.orgId);
  return { ok: true, funnel };
}
