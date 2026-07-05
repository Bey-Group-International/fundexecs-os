// POST /api/professional-network/connect — begin a backend connector's
// user-authorized connection (OAuth or equivalent).
//
// Honest about credential-gated availability: with no provider credentials the
// connector reports unavailable and this returns { pending:true, reason } — a
// well-formed "pending authorization" result, never a fake success. When the
// connector is available and returns an authorization URL, that URL is returned
// for the client to redirect to. TODO(oauth): wire real provider flows.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { PROFESSIONAL_NETWORK_CONNECTORS } from "@/lib/integrations/professional-network";
import type { ProfessionalNetworkSource } from "@/lib/integrations/professional-network";

export const dynamic = "force-dynamic";

type Payload = { provider?: ProfessionalNetworkSource };

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:pro-network-connect`,
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

  const availability = connector.availability();
  if (!availability.available) {
    return NextResponse.json({ pending: true, reason: availability.reason });
  }

  // TODO(oauth): connectUrl returns the provider authorization redirect once
  // credentials are configured; null means no interactive step is needed.
  const connectUrl = connector.connectUrl(auth.ctx.orgId);
  return NextResponse.json({ connectUrl });
}
