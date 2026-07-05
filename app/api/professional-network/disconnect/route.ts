// POST /api/professional-network/disconnect — best-effort disconnect of a
// backend connector for the org.
//
// Clears the connector's stored refresh token (so /status flips back to
// "not connected") and pauses any in-flight sync jobs. Token deletion runs
// under the caller's RLS session and is best-effort — a failed delete still
// pauses the jobs rather than throwing.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { invalidateGooglePeopleTokenCache } from "@/lib/google-oauth";
import { PROFESSIONAL_NETWORK_CONNECTORS } from "@/lib/integrations/professional-network";
import type { ProfessionalNetworkSource } from "@/lib/integrations/professional-network";

export const dynamic = "force-dynamic";

type Payload = { provider?: ProfessionalNetworkSource };

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:pro-network-disconnect`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 20) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Payload | null;
  const connector = payload?.provider
    ? PROFESSIONAL_NETWORK_CONNECTORS.find((c) => c.provider === payload.provider)
    : undefined;
  if (!connector) {
    return NextResponse.json(
      { error: "Required: provider (a known backend connector)." },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();

  // Clear the stored refresh token so the connector reads as "not connected".
  // Best-effort: the job pause below still runs even if the delete fails.
  if (connector.secretKey) {
    await supabase
      .from("org_secrets")
      .delete()
      .eq("organization_id", auth.ctx.orgId)
      .eq("provider", connector.secretKey);
    if (connector.provider === "contacts") {
      invalidateGooglePeopleTokenCache(auth.ctx.orgId);
    }
  }

  // Best-effort: pause any in-flight/queued runs for this provider.
  await supabase
    .from("professional_network_sync_jobs")
    .update({ status: "paused" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("provider", connector.provider)
    .in("status", ["queued", "running"]);

  return NextResponse.json({ ok: true, provider: connector.provider });
}
