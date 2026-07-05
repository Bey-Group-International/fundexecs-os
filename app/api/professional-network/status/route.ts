// GET /api/professional-network/status — the backend connector control panel.
//
// Lists each Professional Network connector with its honest availability
// (credential-gated) plus the org's most recent sync job per provider, so the
// UI can render connect/sync buttons and last-sync status. Backend connectors
// are the primary path; CSV stays the fallback.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { PROFESSIONAL_NETWORK_CONNECTORS } from "@/lib/integrations/professional-network";
import type { ProfessionalNetworkSyncJob } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:pro-network-status`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 60) },
    );
  }

  const supabase = await createServerClient();

  // Recent jobs (RLS-scoped to the org); reduce to the latest per provider.
  const { data: jobs } = await supabase
    .from("professional_network_sync_jobs")
    .select("*")
    .eq("organization_id", auth.ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  const latestByProvider = new Map<string, ProfessionalNetworkSyncJob>();
  for (const job of (jobs ?? []) as ProfessionalNetworkSyncJob[]) {
    if (!latestByProvider.has(job.provider)) latestByProvider.set(job.provider, job);
  }

  // Real connectivity: a connector is "connected" when its refresh token secret
  // exists in the org vault. We check presence only (RLS-scoped), never the
  // ciphertext or the token itself.
  const secretKeys = PROFESSIONAL_NETWORK_CONNECTORS.map((c) => c.secretKey).filter(
    (k): k is string => Boolean(k),
  );
  const connectedKeys = new Set<string>();
  if (secretKeys.length > 0) {
    const { data: secrets } = await supabase
      .from("org_secrets")
      .select("provider")
      .eq("organization_id", auth.ctx.orgId)
      .in("provider", secretKeys);
    for (const row of secrets ?? []) connectedKeys.add(row.provider);
  }

  const connectors = PROFESSIONAL_NETWORK_CONNECTORS.map((c) => {
    const availability = c.availability();
    const lastJob = latestByProvider.get(c.provider) ?? null;
    return {
      provider: c.provider,
      label: c.label,
      available: availability.available,
      connected: c.secretKey ? connectedKeys.has(c.secretKey) : false,
      reason: availability.available ? null : availability.reason,
      lastSync: lastJob
        ? {
            status: lastJob.status,
            syncType: lastJob.sync_type,
            recordsSeen: lastJob.records_seen,
            recordsCreated: lastJob.records_created,
            errorMessage: lastJob.error_message,
            completedAt: lastJob.completed_at,
            createdAt: lastJob.created_at,
          }
        : null,
    };
  });

  return NextResponse.json(
    { connectors },
    { headers: rateLimitHeaders(rateLimit, 60) },
  );
}
