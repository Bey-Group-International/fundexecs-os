import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getPortfolioMonitor } from "@/lib/portfolio-monitor";
import { PortfolioMonitor } from "@/components/portfolio/PortfolioMonitor";
import { PortfolioHealthDashboard } from "@/components/execute/PortfolioHealthDashboard";
import { LPOnboardingStatus } from "@/components/execute/LPOnboardingStatus";
import { ContractStatusBoard } from "@/components/execute/ContractStatusBoard";
import { createServerClient } from "@/lib/supabase/server";
import { computePortfolioHealth } from "@/lib/portfolio-analytics";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const [data, onboardingRes, contractsRes] = await Promise.all([
    getPortfolioMonitor(ctx.orgId),
    supabase.from("lp_onboarding_sessions").select("*").eq("organization_id", ctx.orgId).order("created_at", { ascending: false }).limit(20),
    supabase.from("contracts").select("*").eq("organization_id", ctx.orgId).order("created_at", { ascending: false }).limit(50),
  ]);
  const onboardingSessions = onboardingRes.data ?? [];
  const contracts = contractsRes.data ?? [];
  const healthScore = computePortfolioHealth({
    avgMOIC: 0,
    targetMOIC: 2,
    underperformingCount: 0,
    totalAssets: 0,
    maxConcentrationPct: 0,
    riskAlertCount: 0,
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

      <section className="mt-10">
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Portfolio Health
        </h2>
        <PortfolioHealthDashboard
          healthScore={healthScore}
          assets={[]}
          riskAlerts={[]}
          totalNAV={0}
        />
      </section>

      {onboardingSessions.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            LP Onboarding
          </h2>
          <LPOnboardingStatus sessions={onboardingSessions as Parameters<typeof LPOnboardingStatus>[0]["sessions"]} />
        </section>
      )}

      {contracts.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            Contracts
          </h2>
          <ContractStatusBoard contracts={contracts as Parameters<typeof ContractStatusBoard>[0]["contracts"]} />
        </section>
      )}
    </div>
  );
}
