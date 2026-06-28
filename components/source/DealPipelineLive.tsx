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
import type { InvestmentThesis } from "@/lib/supabase/database.types";

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
  _aiThesisFit?: number;
}

async function enrichDealRow(
  orgId: string,
  deal: DealRow
): Promise<{ enriched?: VerifiedCompany; verified: boolean; confidence: number; provider: string }> {
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
    return {
      enriched: cached.data,
      verified: cached.verified,
      confidence: cached.confidence,
      provider: "apollo",
    };
  }

  try {
    const result = await enrichOrganization(params);
    if (result.status !== "failed" && result.data) {
      await setCached(orgId, "company", "apollo", params as Record<string, unknown>, result);
      return {
        enriched: result.data,
        verified: result.verified,
        confidence: result.confidence,
        provider: "apollo",
      };
    }
  } catch {
    // Non-fatal
  }

  return { verified: false, confidence: 0.2, provider: "manual" };
}

async function scoreDealFit(
  orgId: string,
  deal: DealRow,
  enriched: VerifiedCompany | undefined,
  thesis: InvestmentThesis | null
): Promise<number | undefined> {
  // Need at least a company object to score
  const company: VerifiedCompany | null = enriched ?? null;
  if (!company) return undefined;

  const dealParams = { dealId: deal.id };
  const cached = await getCached<FitAnalysis>(orgId, "deal", "ai_fit", dealParams);
  if (cached?.data) return cached.data.fitScore;

  try {
    const mandate = {
      strategy: thesis?.asset_classes?.join(", ") ?? deal.asset_class ?? undefined,
      geography: thesis?.geographies?.join(", ") ?? deal.geography ?? undefined,
      sector: deal.asset_class ?? undefined,
    };

    const fit = await enrichCompanyFit(company, mandate);

    // Cache with 12h TTL (43200s matches company module TTL)
    const now = new Date().toISOString();
    const fitResult = {
      status: "success" as const,
      data: fit,
      verified: false,
      confidence: 0.8,
      timestamp: now,
      sources: [{ provider: "ai", endpoint: "enrichCompanyFit", latency_ms: 0, verified: false, retrieved_at: now }],
    };
    await setCached(orgId, "deal", "ai_fit", dealParams, fitResult, 43200);

    return fit.fitScore;
  } catch {
    return undefined;
  }
}

/** Colored badge for AI thesis fit score */
function AiFitBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : score >= 40
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : "bg-red-50 text-red-700 ring-1 ring-red-200";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${color}`}
      title="AI thesis fit score"
    >
      <span className="opacity-60">AI</span>
      {score}
    </span>
  );
}

const ENRICH_FALLBACK = { enriched: undefined, verified: false, confidence: 0.2, provider: "manual" as const };

async function loadDeals(): Promise<EnrichedDeal[]> {
  const auth = await requireOrgContext();
  if (!auth.ok) return [];

  const supabase = createServerClient();

  // Load deals and active thesis in parallel
  const [dealsRes, thesisRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, name, stage, asset_class, geography, target_amount, thesis_fit, expected_close, website",
      )
      .eq("organization_id", auth.ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("investment_theses")
      .select("asset_classes, geographies, title, summary")
      .eq("organization_id", auth.ctx.orgId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const { data, error } = dealsRes;
  if (error || !data) { if (error) console.error("[DealPipelineLive] fetch error:", error.message); return []; }

  const rows = data as unknown as DealRow[];
  const thesis = (thesisRes.data ?? null) as InvestmentThesis | null;

  // Enrich up to 20 deals in parallel — per-deal failures fall back gracefully
  // so a broken Apollo call can never wipe out the entire deal list.
  const enrichments = await Promise.all(
    rows.slice(0, 20).map((d) =>
      enrichDealRow(auth.ctx.orgId, d).catch(() => ENRICH_FALLBACK)
    )
  );

  // Score AI thesis fit for each enriched deal (first 20), also in parallel
  const fitScores = await Promise.all(
    rows.slice(0, 20).map((d, i) =>
      scoreDealFit(auth.ctx.orgId, d, enrichments[i]?.enriched, thesis).catch(() => undefined)
    )
  );

  return rows.map((d, i) => {
    const enr = enrichments[i] ?? ENRICH_FALLBACK;
    return {
      ...d,
      _enriched: enr.enriched,
      _verified: enr.verified,
      _confidence: enr.confidence,
      _provider: enr.provider,
      _aiThesisFit: fitScores[i],
    };
  });
}

export async function DealPipelineLive() {
  const deals = await loadDeals();
  const verifiedCount = deals.filter((d) => d._verified).length;
  const aiScoredCount = deals.filter((d) => d._aiThesisFit != null).length;

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
          {aiScoredCount > 0 && (
            <span className="text-xs text-fg-muted">
              {aiScoredCount}/{Math.min(deals.length, 20)} AI-scored
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
                      <div className="flex flex-col gap-1">
                        <AiFitBadge score={d._aiThesisFit} />
                        {d.thesis_fit != null && (
                          <span className="font-mono text-[10px] text-fg-muted/60">
                            manual: {Number(d.thesis_fit).toFixed(1)}
                          </span>
                        )}
                      </div>
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
