// POST /api/professional-network/sync — run a backend connector sync for one
// provider and return the recorded job + result.
//
// Delegates to runProviderSync (sync.server), which records every attempt in
// professional_network_sync_jobs. When the connector has no credentials the
// job is recorded as 'paused' and the response is { pending:true, reason } —
// honest about availability, never a fake success.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { PROFESSIONAL_NETWORK_CONNECTORS } from "@/lib/integrations/professional-network";
import type { ProfessionalNetworkSource } from "@/lib/integrations/professional-network";
import { runProviderSync, type SyncType } from "@/lib/integrations/professional-network/sync.server";

export const dynamic = "force-dynamic";

type Payload = { provider?: ProfessionalNetworkSource; syncType?: SyncType };

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:pro-network-sync`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 10) },
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
  const result = await runProviderSync(supabase, {
    orgId: auth.ctx.orgId,
    userId: auth.ctx.userId,
    provider: connector.provider,
    syncType: payload?.syncType,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, job: result.job });
  }
  if (result.pending) {
    return NextResponse.json({ ok: false, pending: true, reason: result.reason, job: result.job });
  }
  return NextResponse.json({ ok: false, error: result.error, job: result.job }, { status: 502 });
}
