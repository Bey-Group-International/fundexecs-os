import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getPortfolioMonitor } from "@/lib/portfolio-monitor";
import { PortfolioMonitor } from "@/components/portfolio/PortfolioMonitor";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getPortfolioMonitor(ctx.orgId);

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
    </div>
  );
}
