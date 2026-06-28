// components/source/DealPipelineLive.tsx
// Async server component — loads deal pipeline, enriches with Apollo and AI fit scoring,
// then hands off to the DealPipeline client component for interactive rendering.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { VerificationPill } from "@/components/source/VerificationBadge";
import { DealPipeline } from "@/components/source/DealPipeline";
import type { DealEntry } from "@/components/source/DealPipeline";
import { getCached, setCached } from "@/lib/source-cache";
import { enrichOrganization } from "@/lib/integrations/providers/apollo";
import { enrichCompanyFit } from "@/lib/integrations/providers/ai-enrichment";
import type { VerifiedCompany, FitAnalysis } from "@/lib/source-hub-types";

interface DealRow {
  id: string;
  name: string;
  stage: string | null;
  asset_class: string | null;
  geography: string | null;
  target_amount: number | null;
  thesis_fit: number | null;
  expected_close: string | null;
  website: string | null;
}

interface MandateCtx {
  strategy?: string;
  geography?: string;
  sector?: string;
}

async function scoreDealFit(
  orgId: string,
  deal: DealRow,
  company: VerifiedCompany,
  mandate: MandateCtx
): Promise<FitAnalysis | undefined> {
  if (!mandate.strategy) return undefined;

  const sector = mandate.sector ?? deal.asset_class ?? undefined;
  const cacheParams: Record<string, unknown> = {
    dealId: deal.id,
    companyDomain: company.domain,
    companyName: company.name,
    mandateStrategy: mandate.strategy,
    mandateGeography: mandate.geography,
    sector,
  };
  const cached = await getCached<FitAnalysis>(orgId, "deal", "ai_fit", cacheParams);
  if (cached?.data) return cached.data;

  try {
    let _timer: ReturnType<typeof setTimeout> | undefined;
    const fit = await Promise.race([
      enrichCompanyFit(company, { strategy: mandate.strategy, geography: mandate.geography, sector })
        .finally(() => clearTimeout(_timer)),
      new Promise<never>((_, reject) => { _timer = setTimeout(() => reject(new Error("timeout")), 5000); }),
    ]);

    if (!fit || typeof fit.fitScore !== "number" || fit.fitScore < 0) return undefined;

    const result = {
      status: "success" as const,
      verified: true,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      sources: [],
      data: fit,
    };
    await setCached(orgId, "deal", "ai_fit", cacheParams, result, 43200);
    return fit;
  } catch {
    return undefined;
  }
}

async function enrichDealRow(
  orgId: string,
  deal: DealRow,
  mandate: MandateCtx
): Promise<{ enriched?: VerifiedCompany; verified: boolean; confidence: number; provider: string; aiThesisFit?: FitAnalysis }> {
  const domain = deal.website
    ? deal.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : null;

  if (!domain && !deal.name) {
    return { verified: false, confidence: 0.2, provider: "manual" };
  }

  const params = { domain: domain ?? undefined, name: deal.name };
  const cached = await getCached<VerifiedCompany | null>(
    orgId,
    "company",
    "apollo",
    params as Record<string, unknown>
  );

  if (cached?.data) {
    const aiThesisFit = await scoreDealFit(orgId, deal, cached.data, mandate);
    return {
      enriched: cached.data,
      verified: cached.verified,
      confidence: cached.confidence,
      provider: "apollo",
      aiThesisFit,
    };
  }

  try {
    let _apolloTimer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      enrichOrganization(params).finally(() => clearTimeout(_apolloTimer)),
      new Promise<never>((_, reject) => { _apolloTimer = setTimeout(() => reject(new Error("timeout")), 5000); }),
    ]);
    if (result.status !== "failed" && result.data) {
      await setCached(orgId, "company", "apollo", params as Record<string, unknown>, result);
      const aiThesisFit = await scoreDealFit(orgId, deal, result.data, mandate);
      return {
        enriched: result.data,
        verified: result.verified,
        confidence: result.confidence,
        provider: "apollo",
        aiThesisFit,
      };
    }
  } catch {
    // Non-fatal
  }

  return { verified: false, confidence: 0.2, provider: "manual" };
}

const ENRICH_FALLBACK = { enriched: undefined, verified: false, confidence: 0.2, provider: "manual" as const, aiThesisFit: undefined };
const DEAL_ENRICH_CAP = 40;
const DEAL_BATCH_SIZE = 5;

async function loadDeals(): Promise<DealEntry[]> {
  const auth = await requireOrgContext();
  if (!auth.ok) return [];

  const supabase = createServerClient();

  const { data: orgData } = await supabase
    .from("organizations")
    .select("primary_strategy, hq_location, description")
    .eq("id", auth.ctx.orgId)
    .maybeSingle();

  const mandate: MandateCtx = {
    strategy: orgData?.primary_strategy ?? undefined,
    // geography intentionally omitted: hq_location is the org's office address, not its investment
    // mandate. Re-add once a dedicated target_geography / geography_mandate column exists.
  };

  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, name, stage, asset_class, geography, target_amount, thesis_fit, expected_close, website",
    )
    .eq("organization_id", auth.ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) { if (error) console.error("[DealPipelineLive] fetch error:", error.message); return []; }

  const rows = data as unknown as DealRow[];

  const DEAL_PIPELINE_BUDGET_MS = 20_000;
  const deadline = Date.now() + DEAL_PIPELINE_BUDGET_MS;
  const enrichments: Awaited<ReturnType<typeof enrichDealRow>>[] = [];
  for (let i = 0; i < Math.min(rows.length, DEAL_ENRICH_CAP); i += DEAL_BATCH_SIZE) {
    if (Date.now() > deadline) {
      console.warn("[DealPipelineLive] enrichment budget exceeded, truncating at batch", i / DEAL_BATCH_SIZE);
      break;
    }
    const chunk = rows.slice(i, i + DEAL_BATCH_SIZE);
    const results = await Promise.all(
      chunk.map((d) => enrichDealRow(auth.ctx.orgId, d, mandate).catch(() => ENRICH_FALLBACK))
    );
    enrichments.push(...results);
  }

  return rows.map((d, i): DealEntry => {
    const enr = enrichments[i] ?? ENRICH_FALLBACK;
    return {
      id: d.id,
      name: d.name,
      stage: d.stage ?? "sourced",
      assetClass: d.asset_class,
      geography: d.geography,
      targetAmount: d.target_amount,
      thesisFit: d.thesis_fit,
      expectedClose: d.expected_close,
      website: d.website,
      industry: enr.enriched?.industry,
      employeeRange: enr.enriched?.employee_range,
      revenueRange: enr.enriched?.revenue_range,
      aiThesisFit: enr.aiThesisFit,
      verified: enr.verified,
      confidence: enr.confidence,
      provider: enr.provider,
    };
  });
}

export async function DealPipelineLive() {
  const deals = await loadDeals();
  const verifiedCount = deals.filter((d) => d.verified).length;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Deal Pipeline
        </p>
        <div className="flex items-center gap-3">
          {verifiedCount > 0 && (
            <span className="text-xs text-fg-muted">
              {verifiedCount}/{Math.min(deals.length, DEAL_ENRICH_CAP)} enriched via Apollo
            </span>
          )}
        </div>
      </div>
      <DealPipeline deals={deals} enrichCap={DEAL_ENRICH_CAP} />
    </section>
  );
}
