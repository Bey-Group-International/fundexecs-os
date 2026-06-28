// components/source/DealPipelineLive.tsx
// Async server component — renders the active deal pipeline for this org,
// enriched with live Apollo company data and verification badges.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { VerificationPill } from "@/components/source/VerificationBadge";
import { getCached, setCached } from "@/lib/source-cache";
import { enrichOrganization } from "@/lib/integrations/providers/apollo";
import { enrichCompanyFit } from "@/lib/integrations/providers/ai-enrichment";
import type { VerifiedCompany, FitAnalysis } from "@/lib/source-hub-types";

const STAGE_STYLES: Record<string, string> = {
  sourced: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  screening: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  diligence: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  under_contract: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  closed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  passed: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
};

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

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

interface EnrichedDeal extends DealRow {
  _enriched?: VerifiedCompany;
  _verified: boolean;
  _confidence: number;
  _provider: string;
  _aiThesisFit?: FitAnalysis;
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
  const cacheParams: Record<string, unknown> = { dealId: deal.id };
  const cached = await getCached<FitAnalysis>(orgId, "deal", "ai_fit", cacheParams);
  if (cached?.data) return cached.data;

  const sector = mandate.sector ?? deal.asset_class ?? undefined;
  if (!mandate.strategy && !mandate.geography && !sector) {
    // No mandate context — skip AI scoring to avoid misleading scores
    return undefined;
  }

  try {
    const fit = await Promise.race([
      enrichCompanyFit(company, { strategy: mandate.strategy, geography: mandate.geography, sector }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);

    const result = {
      status: "success" as const,
      verified: true,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      sources: [],
      data: fit,
    };
    // 12h TTL
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
    const result = await enrichOrganization(params);
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

async function loadDeals(): Promise<EnrichedDeal[]> {
  const auth = await requireOrgContext();
  if (!auth.ok) return [];

  const supabase = createServerClient();

  // Fetch org to build mandate context for AI fit scoring
  const { data: orgData } = await supabase
    .from("organizations")
    .select("primary_strategy, hq_location, description")
    .eq("id", auth.ctx.orgId)
    .maybeSingle();

  const mandate: MandateCtx = {
    strategy: orgData?.primary_strategy ?? undefined,
    // TODO: hq_location is the org's own HQ, not the fund's target investment geography — prefer a
    // dedicated geography_mandate / target_geography field on organizations when available.
    geography: orgData?.hq_location ?? undefined,
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

  // Enrich up to 40 deals in batches of 5. Lower concurrency than LP enrichment
  // (15) because each deal call chains Apollo → AI scoring sequentially.
  const DEAL_ENRICH_CAP = 40;
  const DEAL_BATCH_SIZE = 5;
  const enrichments: Awaited<ReturnType<typeof enrichDealRow>>[] = [];
  for (let i = 0; i < Math.min(rows.length, DEAL_ENRICH_CAP); i += DEAL_BATCH_SIZE) {
    const chunk = rows.slice(i, i + DEAL_BATCH_SIZE);
    const results = await Promise.all(
      chunk.map((d) => enrichDealRow(auth.ctx.orgId, d, mandate).catch(() => ENRICH_FALLBACK))
    );
    enrichments.push(...results);
  }

  return rows.map((d, i) => {
    const enr = enrichments[i] ?? ENRICH_FALLBACK;
    return {
      ...d,
      _enriched: enr.enriched,
      _verified: enr.verified,
      _confidence: enr.confidence,
      _provider: enr.provider,
      _aiThesisFit: enr.aiThesisFit,
    };
  });
}

export async function DealPipelineLive() {
  const deals = await loadDeals();
  const verifiedCount = deals.filter((d) => d._verified).length;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Deal Pipeline
        </p>
        <div className="flex items-center gap-3">
          {verifiedCount > 0 && (
            <span className="text-xs text-fg-muted">
              {verifiedCount}/{Math.min(deals.length, 20)} enriched via Apollo
            </span>
          )}
          <span className="font-mono text-[11px] text-fg-muted">
            {deals.length} deal{deals.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">No deals yet.</p>
          <p className="mt-1 text-xs text-fg-muted/60">
            Use Earn to source deal targets or add them manually.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Deal
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Stage
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Asset Class
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Target
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Fit
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Source
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Close
                </th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => (
                <tr
                  key={d.id}
                  className={i < deals.length - 1 ? "border-b border-line" : ""}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-fg">{d.name}</p>
                    {/* Show Apollo-enriched data if available */}
                    {d._enriched?.industry ? (
                      <p className="mt-0.5 text-xs text-fg-muted">{d._enriched.industry}</p>
                    ) : d.geography ? (
                      <p className="mt-0.5 text-xs text-fg-muted">{d.geography}</p>
                    ) : null}
                    {d._enriched?.employee_range && (
                      <p className="mt-0.5 text-xs text-fg-muted/60">{d._enriched.employee_range} employees</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                        STAGE_STYLES[d.stage ?? ""] ?? "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {(d.stage ?? "unknown").replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {d.asset_class ?? d._enriched?.industry ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">
                    {/* Prefer Apollo revenue range over stored target amount */}
                    {d._enriched?.revenue_range ?? formatCurrency(d.target_amount)}
                  </td>
                  <td className="px-4 py-3">
                    {d._aiThesisFit != null ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          d._aiThesisFit.fitScore >= 70
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : d._aiThesisFit.fitScore >= 40
                            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            : "bg-red-50 text-red-700 ring-1 ring-red-200"
                        }`}
                        title={d._aiThesisFit.rationale}
                      >
                        {d._aiThesisFit.fitScore}
                      </span>
                    ) : d.thesis_fit != null ? (
                      <span className="font-mono text-xs font-semibold text-accent">
                        {Number(d.thesis_fit).toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <VerificationPill
                      verified={d._verified}
                      confidence={d._confidence}
                      provider={d._provider}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">
                    {d.expected_close ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
