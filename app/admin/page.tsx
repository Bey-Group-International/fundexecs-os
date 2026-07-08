import type { Metadata } from "next";
import { getAdminReport } from "@/lib/admin/reports";
import { StatTile } from "@/components/dashboard/StatTile";
import { SignupsTable } from "./SignupsTable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// The gate runs in app/admin/layout.tsx, so by the time this renders the caller
// is a verified platform admin. This page only shapes the report for display.
export default async function AdminPage() {
  const report = await getAdminReport();
  const { metrics, funnel, signups } = report;

  const generated = new Date(report.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  const maxDay = Math.max(1, ...metrics.signupsByDay.map((d) => d.count));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            Traction &amp; Activity
          </h1>
          <p className="mt-1 font-mono text-[11px] text-fg-muted">
            Cross-org · generated {generated} UTC
          </p>
        </div>
        <a
          href="/api/admin/report?format=csv"
          className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
        >
          ↓ Export signups (CSV)
        </a>
      </div>

      {report.degraded ? (
        <div className="fx-card p-4 text-sm text-status-danger">
          Supabase service-role env is not configured (SUPABASE_SERVICE_ROLE_KEY).
          Cross-org reporting is unavailable until it is set.
        </div>
      ) : null}

      {/* Traction metrics */}
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Traction
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Total users" value={metrics.totalUsers} delay={0} />
          <StatTile label="Total orgs" value={metrics.totalOrgs} delay={40} />
          <StatTile
            label="New · 24h"
            value={metrics.newUsers24h}
            trend={metrics.newUsers24h > 0 ? "up" : "neutral"}
            delay={80}
          />
          <StatTile label="New · 7d" value={metrics.newUsers7d} delay={120} />
          <StatTile label="New · 30d" value={metrics.newUsers30d} delay={160} />
          <StatTile label="DAU" value={metrics.dau} delay={200} />
          <StatTile label="WAU" value={metrics.wau} delay={240} />
          <StatTile label="MAU" value={metrics.mau} delay={280} />
        </div>
      </section>

      {/* Signups per day — last 30 days */}
      <section className="fx-card p-5">
        <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Signups · last 30 days
        </h2>
        <div className="flex h-32 items-end gap-1">
          {metrics.signupsByDay.map((d) => (
            <div
              key={d.date}
              className="group relative flex-1"
              style={{ height: "100%" }}
            >
              <div
                className="absolute bottom-0 w-full rounded-t-sm bg-gold-500/40 transition group-hover:bg-gold-400"
                style={{
                  height: `${Math.round((d.count / maxDay) * 100)}%`,
                  minHeight: d.count > 0 ? "3px" : "0",
                }}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary opacity-0 transition group-hover:opacity-100">
                {d.date.slice(5)} · {d.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Signup funnel */}
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Signup funnel
        </h2>
        <div className="fx-card divide-y divide-line/60">
          {funnel.map((step) => {
            const top = funnel.find((s) => s.count != null)?.count ?? 0;
            const pct =
              step.count != null && top > 0
                ? Math.round((step.count / top) * 100)
                : null;
            return (
              <div key={step.key} className="flex items-center gap-4 p-3.5">
                <div className="w-32 shrink-0">
                  <p className="text-sm text-fg-primary">{step.label}</p>
                  {step.note ? (
                    <p className="font-mono text-[10px] text-fg-muted">
                      {step.note}
                    </p>
                  ) : null}
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2/70">
                  {pct != null ? (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-gold-500/70 to-gold-400"
                      style={{ width: `${pct}%` }}
                    />
                  ) : null}
                </div>
                <div className="w-20 shrink-0 text-right">
                  <span className="font-display text-lg font-bold text-fg-primary">
                    {step.count != null ? step.count : "—"}
                  </span>
                  {pct != null ? (
                    <span className="ml-1 font-mono text-[10px] text-fg-muted">
                      {pct}%
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Signups + activity table */}
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Users &amp; activity ({signups.length})
        </h2>
        <SignupsTable rows={signups} />
      </section>
    </div>
  );
}
