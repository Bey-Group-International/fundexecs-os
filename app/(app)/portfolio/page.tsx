import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getPortfolioMonitor } from "@/lib/portfolio-monitor";
import { PortfolioMonitor } from "@/components/portfolio/PortfolioMonitor";
import { PortfolioHealthDashboard } from "@/components/execute/PortfolioHealthDashboard";
import { ContractStatusBoard } from "@/components/execute/ContractStatusBoard";
import { computePortfolioHealth } from "@/lib/portfolio-analytics";
import type { ConcentrationRisk } from "@/lib/portfolio-analytics";
import type { ContractStatus, DocumentType } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const [data, docsRes] = await Promise.all([
    getPortfolioMonitor(ctx.orgId),
    supabase
      .from("documents")
      .select("id, name, doc_type, created_at")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Map documents into Contract shape for ContractStatusBoard
  const contracts = (docsRes.data ?? []).map((d) => ({
    id: d.id,
    title: d.name ?? "Untitled Document",
    documentType: (d.doc_type ?? "other") as DocumentType,
    status: "signed" as ContractStatus,
    expiryDate: null,
    signedAt: d.created_at,
    effectiveDate: d.created_at,
  }));

  // Derive PortfolioHealthDashboard props from existing monitor data
  const totalNAV = data.totals.nav;
  const assetMetrics = data.assets.map((a) => ({
    id: a.id,
    name: a.name,
    sector: a.assetType,
    geography: "",
    assetClass: a.assetType,
    moic: a.moic,
    irr: null,
    underwriteMOIC: null,
    equityInvested: a.cost,
    currentValue: a.nav,
    concentrationPct: a.concentrationPct,
    isUnderperforming: a.moic != null && a.moic < 1,
    holdPeriodMonths: a.markAgeDays != null ? Math.round(a.markAgeDays / 30) : null,
  }));

  const maxConcentration = Math.max(0, ...data.assets.map((a) => a.concentrationPct));
  const underperformingCount = data.assets.filter((a) => a.moic != null && a.moic < 1).length;
  const avgMOIC =
    data.totals.weightedMoic ??
    (data.assets.reduce((s, a) => s + (a.moic ?? 1), 0) / Math.max(data.assets.length, 1));

  const riskAlerts: ConcentrationRisk[] = data.assets
    .filter((a) => a.concentrationPct > 25)
    .map((a) => ({
      type: "single_asset" as const,
      label: a.name,
      actualPct: a.concentrationPct,
      thresholdPct: 25,
      severity: a.concentrationPct > 40 ? "critical" : a.concentrationPct > 30 ? "high" : "medium",
      affectedAssets: [a.id],
      recommendation: `Reduce ${a.name} allocation from ${a.concentrationPct.toFixed(1)}% to below 25%.`,
    }));

  const healthScore = computePortfolioHealth({
    avgMOIC,
    targetMOIC: 2.0,
    underperformingCount,
    totalAssets: data.assets.length,
    maxConcentrationPct: maxConcentration,
    riskAlertCount: riskAlerts.length,
  });

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Portfolio
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Portfolio Monitor
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Every held asset&apos;s mark versus cost, unrealized gain, MOIC, and
          concentration — with portfolio totals and the alerts that need a look.
        </p>
      </header>

      <PortfolioMonitor data={data} />

      {data.hasData && (
        <section className="mt-12">
          <header className="mb-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Health Dashboard
            </span>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">
              Portfolio Health
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Composite health score, allocation breakdown, concentration risks, and per-asset metrics.
            </p>
          </header>
          <PortfolioHealthDashboard
            healthScore={healthScore}
            assets={assetMetrics}
            riskAlerts={riskAlerts}
            totalNAV={totalNAV}
          />
        </section>
      )}

      {contracts.length > 0 && (
        <section className="mt-12">
          <header className="mb-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Execute
            </span>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">
              Contract Status Board
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              All fund and investment contracts grouped by lifecycle stage, with renewal alerts.
            </p>
          </header>
          <ContractStatusBoard contracts={contracts} />
        </section>
      )}
    </div>
  );
}
