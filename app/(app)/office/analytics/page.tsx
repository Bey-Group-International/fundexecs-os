import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import {
  fetchOfficeAnalytics,
  getMyAnalyticsPref,
} from "@/lib/office/analyticsServer";
import { AnalyticsDashboard } from "@/components/office/AnalyticsDashboard";

export const dynamic = "force-dynamic";

export default async function OfficeAnalyticsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  // Date.now() is fine here (server component); the pure aggregation stays
  // clock-free by taking this timestamp as its `now`.
  const now = Date.now();
  const [summary, optIn] = await Promise.all([
    fetchOfficeAnalytics(ctx.orgId, now),
    getMyAnalyticsPref(ctx.orgId),
  ]);

  return (
    <div className="fx-ambient mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Office analytics
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          How the team shows up
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Presence, room usage, and collaboration across the Virtual Office —
          aggregated only for members who have opted in.
        </p>
      </header>

      <AnalyticsDashboard summary={summary} orgId={ctx.orgId} initialOptIn={optIn} />
    </div>
  );
}
