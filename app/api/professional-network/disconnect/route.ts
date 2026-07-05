// POST /api/professional-network/disconnect — best-effort disconnect of a
// backend connector for the org.
//
// There are no provider secrets to revoke yet, so this marks the org's
// non-terminal sync jobs for the provider as 'paused' to reflect the
// disconnected state in the UI. TODO(oauth): revoke stored OAuth tokens and
// tear down the connection record once credential storage exists.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
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

  // Best-effort: pause any in-flight/queued runs for this provider. No secrets
  // to revoke yet. TODO(oauth): revoke stored tokens + drop the connection.
  await supabase
    .from("professional_network_sync_jobs")
    .update({ status: "paused" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("provider", connector.provider)
    .in("status", ["queued", "running"]);

  return NextResponse.json({ ok: true, provider: connector.provider });
}
