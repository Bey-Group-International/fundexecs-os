import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Deal, Approval } from "@/lib/supabase/database.types";
import { MissionControl } from "@/components/dashboard/MissionControl";
import { SystemsOfRecord } from "@/components/dashboard/SystemsOfRecord";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { HottestCapital, PendingGates } from "./CapitalSignals";
import { StaleDealAlerts } from "@/components/dashboard/StaleDealAlerts";
import { FirstMissionCoach } from "@/components/dashboard/FirstMissionCoach";
import { buildCapitalMap } from "@/lib/capital-map";
import { getBuildReadiness } from "@/lib/build-readiness";
import {
  getInstitutionalDashboard,
  type KpiMetric,
  type CapitalPanelData,
  type PortfolioPanelData,
} from "@/lib/dashboard/institutional";

export const dynamic = "force-dynamic";

const DEAL_STAGES = ["sourced", "screening", "diligence", "ic_review", "closing"] as const;
const STAGE_COLORS: Record<string, string> = {
  sourced: "#38bdf8",
  screening: "#6366f1",
  diligence: "#f59e0b",
  ic_review: "#ef4444",
  closing: "#5FB87A",
};

const KPI_TONE: Record<KpiMetric["tone"], string> = {
  gold: "text-gold-300",
  neural: "text-neural-300",
  success: "text-status-success",
  muted: "text-fg-muted",
};

function compactUsd(n: number | null): string {
  if (!n || n <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

// Standardized section heading — glowing left bar, bold mono label, optional action.
function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-secondary">
        <span aria-hidden className="fx-heading-bar" />
        {children}
      </h2>
      {action}
    </div>
  );
}

function KpiTile({ kpi, delay }: { kpi: KpiMetric; delay: number }) {
  return (
    <Link
      href={kpi.href}
      className="fx-card fx-card-hover fx-stat-shimmer group relative overflow-hidden p-4 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/55 to-transparent transition-opacity duration-300 group-hover:via-gold-300/80"
      />
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-muted">{kpi.label}</p>
      <p className={`mt-2 font-display text-[1.75rem] font-bold leading-none tracking-tight ${KPI_TONE[kpi.tone]} transition-colors duration-200`}>
        {kpi.value}
      </p>
      {kpi.sub ? (
        <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-wider text-fg-muted/80">
          {kpi.sub}
        </p>
      ) : null}
    </Link>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface-2/40 px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-fg-muted">{label}</p>
      <p className="mt-1 font-display text-lg font-bold leading-none tracking-tight text-fg-primary">{value}</p>
      {sub ? <p className="mt-1 truncate text-[10px] text-fg-muted">{sub}</p> : null}
    </div>
  );
}

function CapitalPanel({ data }: { data: CapitalPanelData }) {
  const calledPct = data.committed > 0 ? Math.min(100, (data.called / data.committed) * 100) : 0;
  const distPct = data.committed > 0 ? Math.min(100, (data.distributed / data.committed) * 100) : 0;
  return (
    <div className="fx-card p-5">
      <SectionHeading
        action={
          <Link href="/source/lp_pipeline" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
            LP pipeline →
          </Link>
        }
      >
        Capital &amp; LPs
      </SectionHeading>

      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat label="Committed" value={compactUsd(data.committed)} />
        <MiniStat label="Called" value={compactUsd(data.called)} />
        <MiniStat label="Distributed" value={compactUsd(data.distributed)} />
      </div>

      {/* Called / distributed against committed — a single capital-progress bar. */}
      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-surface-3/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-500 to-gold-300 shadow-[0_0_10px_rgba(212,175,106,0.5)] transition-[width] duration-500"
          style={{ width: `${calledPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-status-success/80 transition-[width] duration-500"
          style={{ width: `${distPct}%` }}
        />
      </div>
      <p className="mt-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {data.dpi != null ? `${data.dpi.toFixed(2)}× DPI` : "DPI —"} · {data.investorCount} investor
        {data.investorCount === 1 ? "" : "s"} · {data.fundCount} fund{data.fundCount === 1 ? "" : "s"}
      </p>

      {data.recentEvents.length > 0 ? (
        <div className="mt-4 border-t border-line/60 pt-3">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted/70">Recent capital events</p>
          <div className="flex flex-col gap-1.5">
            {data.recentEvents.slice(0, 4).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate capitalize text-fg-secondary">{e.type.replace(/_/g, " ")}</span>
                <span className="shrink-0 font-mono text-xs text-fg-primary">{compactUsd(e.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PortfolioPanel({ data }: { data: PortfolioPanelData }) {
  return (
    <div className="fx-card p-5">
      <SectionHeading
        action={
          <Link href="/source/deal_pipeline" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
            Deal pipeline →
          </Link>
        }
      >
        Deals &amp; Portfolio
      </SectionHeading>

      <div className="grid grid-cols-2 gap-2.5">
        <MiniStat label="Pipeline value" value={compactUsd(data.pipelineValue)} sub={`${data.dealCount} deal${data.dealCount === 1 ? "" : "s"}`} />
        <MiniStat label="Portfolio NAV" value={compactUsd(data.portfolioNav)} sub={`${data.assetCount} asset${data.assetCount === 1 ? "" : "s"}`} />
      </div>

      {/* Pipeline shape bar + per-stage counts. */}
      {data.dealCount > 0 ? (
        <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-surface-3/60">
          {data.byStage.map(({ stage, count }) => {
            const pct = (count / data.dealCount) * 100;
            if (pct === 0) return null;
            return (
              <div
                key={stage}
                className="h-full transition-[width] duration-700"
                style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[stage] }}
                title={`${stage.replace("_", " ")}: ${count}`}
              />
            );
          })}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {data.byStage.map(({ stage, count }) => {
          const color = STAGE_COLORS[stage] ?? "#38bdf8";
          return (
            <div key={stage} className="rounded-md border border-line/60 bg-surface-2/40 px-1.5 py-2 text-center">
              <p
                className="font-display text-lg font-bold leading-none tracking-tight"
                style={{ color: count > 0 ? color : undefined }}
              >
                {count}
              </p>
              <p className="mt-1 font-mono text-[8px] uppercase tracking-wide text-fg-muted">
                {stage.replace("_", " ")}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {data.diligenceOpen} diligence open · {data.icRecent} recent IC decision{data.icRecent === 1 ? "" : "s"}
      </p>

      {data.recentMarks.length > 0 ? (
        <div className="mt-4 border-t border-line/60 pt-3">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted/70">Latest valuation marks</p>
          <div className="flex flex-col gap-1.5">
            {data.recentMarks.slice(0, 4).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-fg-secondary">{m.assetName}</span>
                <span className="shrink-0 font-mono text-xs text-fg-primary">{compactUsd(m.value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [dashboard, capitalMap, readiness, pendingGatesRes, dealsRes] = await Promise.all([
    getInstitutionalDashboard(supabase, ctx.orgId),
    buildCapitalMap(supabase),
    getBuildReadiness(ctx.orgId),
    supabase.from("approvals").select("*").eq("decision", "pending").order("created_at", { ascending: false }).limit(5),
    supabase.from("deals").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(30),
  ]);

  const pendingGates = (pendingGatesRes.data ?? []) as Approval[];
  const deals = (dealsRes.data ?? []) as Deal[];
  const hottestCapital = capitalMap.slice(0, 5);

  const now = Date.now();
  const staleDeals = deals
    .map((d) => {
      const lastActivity = d.updated_at ?? d.created_at;
      const daysStale = Math.floor((now - new Date(lastActivity).getTime()) / 86_400_000);
      return {
        id: d.id,
        name: d.name,
        stage: d.stage,
        daysStale,
        lastActivityDate: lastActivity,
        assignee: d.lead_principal ?? null,
        dealValue: d.target_amount ?? null,
      };
    })
    .filter((d) => d.daysStale >= 14)
    .sort((a, b) => b.daysStale - a.daysStale);

  const isFirstVisit = dashboard.portfolio.dealCount === 0 && dashboard.capital.investorCount === 0;

  return (
    <div className="fx-ambient fx-blueprint mx-auto max-w-6xl">
      <header className="fx-glass relative mb-6 overflow-hidden animate-fade-up">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_80%_at_92%_10%,rgba(56,189,248,0.10),transparent_70%)]"
        />

        {/* Official program identity strip. */}
        <div className="relative flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo as="span" variant="coin" />
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">FundExecs OS</span>
            <span aria-hidden className="text-fg-muted/50">/</span>
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.2em] text-fg-secondary">Dashboard</span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-status-success">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-status-success" />
            </span>
            <span className="hidden sm:inline">Systems operational</span>
            <span className="sm:hidden">Live</span>
          </span>
        </div>

        {/* Program masthead. */}
        <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="relative">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary sm:text-4xl">
              Private Markets Command Center
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">
              The institutional dashboard for the program — every live system of record and
              all activity across capital, deals, portfolio, and operations in one governed view.
            </p>
          </div>
          <div className="relative flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/workspace"
              className="group relative overflow-hidden rounded-lg bg-gradient-to-r from-gold-400 to-gold-500 px-4 py-2 text-xs font-semibold text-surface-0 shadow-[0_8px_20px_-10px_rgb(var(--fx-gold-rgb)/0.8)] transition hover:from-gold-300 hover:to-gold-400 hover:shadow-[0_12px_28px_-10px_rgb(var(--fx-gold-rgb)/0.9)]"
            >
              <span aria-hidden className="absolute inset-0 bg-white/10 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              New Session
            </Link>
          </div>
        </div>
      </header>

      {/* Headline instrument row — the program's vital metrics. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {dashboard.kpis.map((kpi, i) => (
          <KpiTile key={kpi.key} kpi={kpi} delay={i * 50} />
        ))}
      </section>

      {/* Systems of record — the whole operating estate at a glance. */}
      <section className="mt-8">
        <SectionHeading>Systems of record</SectionHeading>
        <SystemsOfRecord systems={dashboard.systems} />
      </section>

      {/* Anchor panels — the two pillars the program runs on. */}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <CapitalPanel data={dashboard.capital} />
        <PortfolioPanel data={dashboard.portfolio} />
      </section>

      {/* Live activity + what needs the operator. */}
      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionHeading
            action={
              <Link href="/activity" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
                Full activity →
              </Link>
            }
          >
            Live activity
          </SectionHeading>
          <ActivityFeed items={dashboard.activity} />
        </div>
        <div className="flex flex-col gap-6">
          <PendingGates approvals={pendingGates} />
          <HottestCapital entries={hottestCapital} />
        </div>
      </section>

      {staleDeals.length > 0 ? (
        <section className="mt-8">
          <StaleDealAlerts deals={staleDeals} />
        </section>
      ) : null}

      {/* Hub standings — where each operating hub stands and the next best move. */}
      <section className="mt-8">
        <SectionHeading>Hub standings</SectionHeading>
        <MissionControl orgId={ctx.orgId} />
      </section>

      {/* Investor readiness — foundation progress, always visible. */}
      <Link href="/build" className="fx-card fx-card-hover mt-4 flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Investor Readiness</span>
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {readiness.stage.label}
            </span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-3/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300 shadow-[0_0_12px_rgba(212,175,106,0.5)] transition-[width] duration-500"
              style={{ width: `${readiness.overall}%` }}
            />
          </div>
          <p className="mt-2 truncate text-xs text-fg-muted">
            {readiness.nextAction ? `Next: ${readiness.nextAction.label} →` : "Foundation complete — fundraising-ready."}
          </p>
        </div>
        <span className="font-display text-3xl font-semibold tracking-tight text-fg-primary">
          {readiness.overall}
          <span className="text-lg text-fg-muted">%</span>
        </span>
      </Link>

      {/* UX-01: First mission coaching — fires once when the org has no records. */}
      <FirstMissionCoach isFirstVisit={isFirstVisit} />
    </div>
  );
}
