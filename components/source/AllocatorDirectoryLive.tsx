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

interface EnrichedData {
  website?: string;
  description?: string;
  confidence: number;
  verified: boolean;
  provider: string;
  hqCity?: string;
  hqCountry?: string;
  primaryStrategies: string[];
}

async function enrichInvestorRow(
  orgId: string,
  inv: InvestorRow
): Promise<EnrichedData> {
  const domain = inv.website
    ? inv.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : null;

  if (!domain && !inv.name) {
    return { confidence: inv.confidence ?? 0.3, verified: inv.verified ?? false, provider: inv.source_provider ?? "manual", primaryStrategies: [] };
  }

  const params = { domain: domain ?? undefined, name: inv.name };
  const cached = await getCached<{ name: string; domain?: string; description?: string; confidence: number; headquarters?: string; industry?: string; keywords?: string[] } | null>(
    orgId,
    "investor",
    "apollo",
    params as Record<string, unknown>
  );

  if (cached?.data) {
    const hqParts = cached.data.headquarters?.split(", ") ?? [];
    return {
      website: domain ? `https://${domain}` : undefined,
      description: cached.data.description,
      confidence: cached.data.confidence,
      verified: cached.verified,
      provider: "apollo",
      hqCity: hqParts[0],
      hqCountry: hqParts.length >= 2 && hqParts[hqParts.length - 1].length >= 2 ? hqParts[hqParts.length - 1] : undefined,
      primaryStrategies: cached.data.keywords ?? (cached.data.industry ? [cached.data.industry] : []),
    };
  }

  try {
    const result = await enrichOrganization(params);
    if (result.status !== "failed" && result.data) {
      await setCached(orgId, "investor", "apollo", params as Record<string, unknown>, result);
      const hqParts = result.data.headquarters?.split(", ") ?? [];
      return {
        website: result.data.website,
        description: result.data.description,
        confidence: result.data.confidence,
        verified: result.verified,
        provider: "apollo",
        hqCity: hqParts[0],
        hqCountry: hqParts.length >= 2 && hqParts[hqParts.length - 1].length >= 2 ? hqParts[hqParts.length - 1] : undefined,
        primaryStrategies: result.data.keywords ?? (result.data.industry ? [result.data.industry] : []),
      };
    }
  } catch {
    // Enrichment failure is non-fatal
  }

  return {
    confidence: inv.confidence ?? 0.3,
    verified: inv.verified ?? false,
    provider: inv.source_provider ?? "manual",
    primaryStrategies: [],
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
    const { orgId } = auth.ctx;

    // Enrich all rows with a concurrency cap to avoid rate-limiting Apollo on cold cache.
    // Cache-first: 24h TTL means most calls are instant on warm loads.
    async function batchEnrich(items: InvestorRow[], concurrency: number) {
      const results: EnrichedData[] = [];
      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const chunkResults = await Promise.all(chunk.map((inv) => enrichInvestorRow(orgId, inv)));
        results.push(...chunkResults);
      }
      return results;
    }

    // Cap enrichment at 75 rows per render to stay well within serverless timeouts.
    // Rows beyond the cap fall back to stored DB values.
    const ENRICH_CAP = 75;
    const [enriched, relationships] = await Promise.all([
      batchEnrich(rows.slice(0, ENRICH_CAP), 15),
      getLPRelationshipSummaries(supabase, auth.ctx.orgId, rows.map((r) => r.id)),
    ]);

    return rows.map((inv, i) => {
      const enr = enriched[i] ?? { confidence: inv.confidence ?? 0.3, verified: inv.verified ?? false, provider: "manual", primaryStrategies: [] };
      const rel = relationships.get(inv.id);
      return {
        id: inv.id,
        name: inv.name,
        allocatorType: (inv.investor_type ?? "family_office") as AllocatorType,
        aumMin: inv.aum ? inv.aum * 0.8 : null,
        aumMax: inv.aum ?? null,
        ticketMin: inv.typical_check_min ?? null,
        ticketMax: inv.typical_check_max ?? null,
        primaryStrategies: enr.primaryStrategies,
        geographicFocus: inv.jurisdiction ? [inv.jurisdiction] : [],
        accreditationStatus: "verified" as AccreditationStatus,
        kycStatus: "verified" as const,
        hqCity: enr.hqCity,
        // TODO: inv.jurisdiction may be a US state — consider a dedicated hq_country DB column
        hqCountry: enr.hqCountry ?? inv.jurisdiction ?? undefined,
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
