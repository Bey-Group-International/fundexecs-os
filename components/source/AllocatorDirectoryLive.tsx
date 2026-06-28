// components/source/AllocatorDirectoryLive.tsx
// Async server component — loads first-party investor data, enriches it with
// live Apollo data where available, and surfaces verification metadata.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AllocatorDirectory } from "@/components/source/AllocatorDirectory";
import { VerificationPill } from "@/components/source/VerificationBadge";
import { getCached, setCached } from "@/lib/source-cache";
import { enrichOrganization } from "@/lib/integrations/providers/apollo";
import { getLPRelationshipSummaries } from "@/lib/lp-relationships";
import type { AllocatorType, AccreditationStatus } from "@/lib/allocator-directory";

interface InvestorRow {
  id: string;
  name: string;
  investor_type: string | null;
  aum: number | null;
  typical_check_min: number | null;
  typical_check_max: number | null;
  jurisdiction: string | null;
  pipeline_stage: string | null;
  verified: boolean | null;
  confidence: number | null;
  source_provider: string | null;
  last_verified_at: string | null;
  website: string | null;
}

async function enrichInvestorRow(
  orgId: string,
  inv: InvestorRow
): Promise<{ website?: string; description?: string; confidence: number; verified: boolean; provider: string }> {
  const domain = inv.website
    ? inv.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : null;

  if (!domain && !inv.name) {
    return { confidence: inv.confidence ?? 0.3, verified: inv.verified ?? false, provider: inv.source_provider ?? "manual" };
  }

  const params = { domain: domain ?? undefined, name: inv.name };
  const cached = await getCached<{ name: string; domain?: string; description?: string; confidence: number } | null>(
    orgId,
    "investor",
    "apollo",
    params as Record<string, unknown>
  );

  if (cached?.data) {
    return {
      website: domain ? `https://${domain}` : undefined,
      description: cached.data.description,
      confidence: cached.data.confidence,
      verified: cached.verified,
      provider: "apollo",
    };
  }

  try {
    const result = await enrichOrganization(params);
    if (result.status !== "failed" && result.data) {
      await setCached(orgId, "investor", "apollo", params as Record<string, unknown>, result);
      return {
        website: result.data.website,
        description: result.data.description,
        confidence: result.data.confidence,
        verified: result.verified,
        provider: "apollo",
      };
    }
  } catch {
    // Enrichment failure is non-fatal
  }

  return {
    confidence: inv.confidence ?? 0.3,
    verified: inv.verified ?? false,
    provider: inv.source_provider ?? "manual",
  };
}

async function loadAllocatorEntries() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return [];
    const supabase = createServerClient();
    const { data: investorRows } = await supabase
      .from("investors")
      .select(
        "id, name, investor_type, aum, typical_check_min, typical_check_max, jurisdiction, pipeline_stage, verified, confidence, source_provider, last_verified_at, website",
      )
      .eq("organization_id", auth.ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(200);

    const rows = (investorRows ?? []) as unknown as InvestorRow[];

    const [enriched, relationships] = await Promise.all([
      Promise.all(rows.slice(0, 20).map((inv) => enrichInvestorRow(auth.ctx.orgId, inv))),
      getLPRelationshipSummaries(supabase, auth.ctx.orgId, rows.map((r) => r.id)),
    ]);

    return rows.map((inv, i) => {
      const enr = enriched[i] ?? { confidence: inv.confidence ?? 0.3, verified: inv.verified ?? false, provider: "manual" };
      const rel = relationships.get(inv.id);
      return {
        id: inv.id,
        name: inv.name,
        allocatorType: (inv.investor_type ?? "family_office") as AllocatorType,
        aumMin: inv.aum ? inv.aum * 0.8 : null,
        aumMax: inv.aum ?? null,
        ticketMin: inv.typical_check_min ?? null,
        ticketMax: inv.typical_check_max ?? null,
        primaryStrategies: [] as string[],
        geographicFocus: inv.jurisdiction ? [inv.jurisdiction] : [],
        accreditationStatus: "verified" as AccreditationStatus,
        kycStatus: "verified" as const,
        hqCity: undefined,
        hqCountry: inv.jurisdiction ?? undefined,
        fitScore: undefined,
        pipelineStage: inv.pipeline_stage ?? "prospect",
        lastContactDays: rel?.lastContactDays ?? null,
        topActionTitle: rel?.topActionTitle ?? null,
        topActionType: rel?.topActionType ?? null,
        // Verification metadata
        _verified: enr.verified,
        _confidence: enr.confidence,
        _provider: enr.provider,
      };
    });
  } catch {
    return [];
  }
}

async function loadFunds(orgId: string) {
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("funds")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

export async function AllocatorDirectoryLive() {
  const auth = await requireOrgContext().catch(() => null);
  const orgId = auth?.ok ? auth.ctx.orgId : null;

  const [entries, funds] = await Promise.all([
    loadAllocatorEntries(),
    orgId ? loadFunds(orgId) : Promise.resolve([]),
  ]);

  const verifiedCount = entries.filter((e) => (e as { _verified?: boolean })._verified).length;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Allocator Intelligence Directory
        </p>
        {entries.length > 0 && (
          <div className="flex items-center gap-2">
            <VerificationPill
              verified={verifiedCount > 0}
              confidence={verifiedCount / Math.max(entries.length, 1)}
              provider="apollo"
            />
            <span className="text-xs text-fg-muted">
              {verifiedCount}/{entries.length} live
            </span>
          </div>
        )}
      </div>
      <AllocatorDirectory entries={entries} funds={funds} />
    </section>
  );
}
