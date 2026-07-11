import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/agents";
import type { Task, Deal, Asset, Artifact, AgentKey } from "@/lib/supabase/database.types";
import { SessionsSection } from "./SessionsSection";
import { MissionControl } from "@/components/dashboard/MissionControl";
import { StatTile } from "@/components/dashboard/StatTile";
import { HottestCapital, PendingGates } from "./CapitalSignals";
import { Outbox } from "./Outbox";
import type { Session, SessionGroup, Approval, DispatchLog } from "@/lib/supabase/database.types";
import { ArtifactCard } from "@/components/ArtifactViewer";
import { buildCapitalMap } from "@/lib/capital-map";
import { getBuildReadiness } from "@/lib/build-readiness";
import { getInboxThreads } from "@/lib/inbox/data";
import { buildDigest, priorityBucket, type DigestThread } from "@/lib/inbox/intelligence";
import { channelMeta } from "@/lib/inbox/channels";
import { dashboardWorkspaces } from "@/lib/dashboard/config";
import { WorkspaceCard } from "@/components/dashboard/WorkspaceCard";
import { FirstMissionCoach } from "@/components/dashboard/FirstMissionCoach";
import { StaleDealAlerts } from "@/components/dashboard/StaleDealAlerts";
import { ProactiveSection } from "./ProactiveSection";
import {
  DeleteWorkflowBtn,
  ClearWorkflowsBtn,
  DeleteDealBtn,
  ClearDealsBtn,
  DeleteArtifactBtn,
  ClearArtifactsBtn,
} from "./DashboardDeleteControls";

export const dynamic = "force-dynamic";

const AGENT_GROUPS: { label: string; keys: AgentKey[] }[] = [
  { label: "Research", keys: ["analyst", "diligence"] },
  { label: "Workflow", keys: ["associate", "investor_relations"] },
  { label: "Execution", keys: ["portfolio_ops", "fund_admin"] },
];

const ACTIVE = new Set(["pending", "in_progress", "awaiting_approval", "blocked"]);
const DEAL_STAGES = ["sourced", "screening", "diligence", "ic_review", "closing"] as const;

const STAGE_COLORS: Record<string, string> = {
  sourced: "#38bdf8",
  screening: "#6366f1",
  diligence: "#f59e0b",
  ic_review: "#ef4444",
  closing: "#5FB87A",
};

function compactUsd(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="fx-card fx-card-hover fx-stat-shimmer group relative overflow-hidden p-4 animate-fade-up">
      {/* Top-edge gold hairline brightens on hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/55 to-transparent transition-opacity duration-300 group-hover:via-gold-300/80"
      />
      {/* Bottom neural sweep on hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-neural-400/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">{label}</p>
      <p className="mt-2 font-display text-[2.1rem] font-bold leading-none tracking-tight text-fg-primary transition-colors duration-200 group-hover:text-white">
        {value}
      </p>
      {/* Ghost watermark number — subtle depth */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1.5 right-3 select-none font-display text-[2rem] font-bold leading-none text-gold-400/6 transition-colors duration-300 group-hover:text-gold-400/12"
      >
        {value}
      </span>
    </div>
  );
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

export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [
    allTasksRes,
    workflowsRes,
    dealsRes,
    assetsRes,
    artifactsRes,
    sessionsRes,
    groupsRes,
    pendingGatesRes,
    dispatchLogRes,
    capitalMap,
    readiness,
    inboxViews,
  ] = await Promise.all([
    supabase.from("tasks").select("*"),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_task_id", null)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("deals").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(8),
    supabase.from("assets").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("artifacts").select("*").order("created_at", { ascending: false }).limit(6),
    supabase.from("sessions").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("session_groups").select("*").order("created_at", { ascending: true }),
    supabase
      .from("approvals")
      .select("*")
      .eq("decision", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
    // The dispatch audit log — most-recent first for the Outbox.
    supabase
      .from("dispatch_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8),
    // The Capital Map is already org-scoped via RLS and pre-sorted hottest-first.
    buildCapitalMap(supabase),
    // Build-hub foundation readiness — surfaced here so progress is visible
    // from the Command Center, not just inside the Build hub.
    getBuildReadiness(ctx.orgId),
    // Unified Inbox threads — surfaced as a digest so the Command Center shows
    // what's waiting on the operator, not just what Earn produced.
    getInboxThreads(supabase),
  ]);

  const tasks = (allTasksRes.data ?? []) as Task[];
  const workflows = (workflowsRes.data ?? []) as Task[];
  const deals = (dealsRes.data ?? []) as Deal[];
  const assets = (assetsRes.data ?? []) as Asset[];
  const artifacts = (artifactsRes.data ?? []) as Artifact[];
  const sessions = (sessionsRes.data ?? []) as Session[];
  const sessionGroups = (groupsRes.data ?? []) as SessionGroup[];
  const pendingGates = (pendingGatesRes.data ?? []) as Approval[];
  const dispatches = (dispatchLogRes.data ?? []) as DispatchLog[];
  // Top 5 investors by warmth — the entries arrive pre-sorted hottest-first.
  const hottestCapital = capitalMap.slice(0, 5);

  const stepsCompleted = tasks.filter((t) => t.parent_task_id && t.status === "completed").length;
  const workload = new Map<AgentKey, number>();
  for (const t of tasks) {
    if (ACTIVE.has(t.status)) workload.set(t.assigned_agent, (workload.get(t.assigned_agent) ?? 0) + 1);
  }
  const dealByStage = new Map<string, number>();
  for (const d of deals) dealByStage.set(d.stage, (dealByStage.get(d.stage) ?? 0) + 1);

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

  // Unified Inbox digest + the few threads that actually need attention today.
  const inboxDigest = buildDigest(
    inboxViews.map(({ thread }): DigestThread => ({
      category: thread.category,
      status: thread.status,
      unread: thread.unread,
      priority: thread.priority,
    })),
  );
  const inboxTop = inboxViews
    .filter(({ thread }) => thread.status === "open")
    .slice(0, 4)
    .map(({ thread, context }) => ({
      id: thread.id,
      subject: thread.subject,
      counterparty: thread.counterparty_name ?? thread.counterparty_email ?? "Unknown",
      icon: channelMeta(thread.channel).icon,
      bucket: priorityBucket(thread.priority),
      contextName: context?.name ?? null,
    }));

  return (
    <div className="fx-ambient fx-blueprint mx-auto max-w-6xl">
      <header className="fx-glass relative mb-6 overflow-hidden animate-fade-up">
        {/* Ambient right-side glow */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_80%_at_92%_10%,rgba(56,189,248,0.10),transparent_70%)]"
        />

        {/* Official program identity strip — brand mark, program name, and
            live system status. Reads as the masthead of an institutional
            operating dashboard rather than a marketing hero. */}
        <div className="relative flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo as="span" variant="coin" />
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
              FundExecs OS
            </span>
            <span aria-hidden className="text-fg-muted/50">/</span>
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.2em] text-fg-secondary">
              Command Center
            </span>
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

        {/* Program masthead — title, mandate line, and primary action. */}
        <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="relative">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary sm:text-4xl">
              Private Markets Command Center
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">
              The official operating surface for the program — deal flow, capital,
              approvals, and deliverables, unified in one governed view.
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

      {/* Mission control — each hub's headline signal + next-best action. */}
      <div className="mb-6">
        <MissionControl orgId={ctx.orgId} />
      </div>

      {/* Earn Initiative — self-authored Commands surfaced as finished decisions,
          with pre-run drafts, provenance, and blast-radius gates. */}
      <ProactiveSection orgId={ctx.orgId} />

      <section className="mb-8">
        <SectionHeading>Operating workspaces</SectionHeading>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboardWorkspaces.map((workspace) => (
            <WorkspaceCard key={workspace.key} workspace={workspace} />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Workflows" value={workflows.length} delay={0} />
        <StatTile label="Deliverables" value={stepsCompleted} delay={60} />
        <StatTile label="Deals in pipeline" value={deals.length} delay={120} />
        <StatTile label="Portfolio assets" value={assets.length} delay={180} />
      </section>

      <Link
        href="/build"
        className="fx-card fx-card-hover mt-3 flex items-center gap-4 p-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Investor Readiness
            </span>
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
            {readiness.nextAction
              ? `Next: ${readiness.nextAction.label} →`
              : "Foundation complete — fundraising-ready."}
          </p>
        </div>
        <span className="font-display text-3xl font-semibold tracking-tight text-fg-primary">
          {readiness.overall}
          <span className="text-lg text-fg-muted">%</span>
        </span>
      </Link>

      {staleDeals.length > 0 && (
        <section className="mt-8">
          <StaleDealAlerts deals={staleDeals} />
        </section>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <HottestCapital entries={hottestCapital} />
        <PendingGates approvals={pendingGates} />
      </section>

      <section className="mt-8">
        <SectionHeading
          action={
            <Link href="/inbox" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
              Open inbox →
            </Link>
          }
        >
          Unified Inbox
        </SectionHeading>
        {inboxTop.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Booking, messaging, and video threads land in your{" "}
            <Link href="/inbox" className="text-gold-400 hover:underline">
              unified inbox
            </Link>
            , triaged and ranked. Nothing waiting right now.
          </p>
        ) : (
          <div className="fx-card p-4">
            <p className="mb-3 text-sm text-fg-secondary">{inboxDigest.headline}</p>
            <div className="flex flex-col gap-2">
              {inboxTop.map((t) => (
                <Link
                  key={t.id}
                  href="/inbox"
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-surface-2"
                >
                  <span className="font-mono text-base leading-none text-gold-400">{t.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg-primary">{t.subject}</span>
                    <span className="block truncate text-[11px] text-fg-muted">
                      {t.counterparty}
                      {t.contextName ? ` · ${t.contextName}` : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${
                      t.bucket === "now"
                        ? "text-status-success"
                        : t.bucket === "soon"
                          ? "text-gold-400"
                          : "text-fg-muted"
                    }`}
                  >
                    {t.bucket}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      <Outbox rows={dispatches} />

      <SessionsSection sessions={sessions} groups={sessionGroups} />

      <section className="mt-8">
        <SectionHeading>AI Agent Workforce</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-3">
          {AGENT_GROUPS.map((group) => (
            <div key={group.label} className="fx-card p-4">
              <p className="mb-3.5 font-mono text-[10px] uppercase tracking-widest text-gold-400">
                {group.label}
              </p>
              <div className="flex flex-col gap-3">
                {group.keys.map((key) => {
                  const agent = AGENTS.find((a) => a.key === key)!;
                  const count = workload.get(key) ?? 0;
                  const active = count > 0;
                  return (
                    <div key={key} className="flex items-center gap-2.5">
                      {/* Status dot with live glow ring when active */}
                      <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                        {active && (
                          <span
                            className="absolute inset-0 rounded-full animate-ping opacity-60"
                            style={{ backgroundColor: agent.color }}
                          />
                        )}
                        <span
                          className="relative h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: agent.color,
                            boxShadow: active ? `0 0 10px ${agent.color}` : "none",
                            opacity: active ? 1 : 0.35,
                          }}
                        />
                      </span>
                      <span className={`text-sm ${active ? "text-fg-primary font-medium" : "text-fg-secondary"}`}>
                        {agent.name}
                      </span>
                      <span
                        className={`ml-auto font-mono text-[10px] tabular-nums ${active ? "text-gold-300" : "text-fg-muted"}`}
                      >
                        {active ? `${count} active` : "idle"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeading action={workflows.length > 0 ? <ClearWorkflowsBtn /> : undefined}>Recent workflows</SectionHeading>
          <div className="flex flex-col gap-2">
            {workflows.length === 0 ? (
              <p className="text-sm text-fg-muted">
                None yet —{" "}
                <Link href="/workspace" className="text-gold-400 hover:underline">
                  run one in Earn
                </Link>
                .
              </p>
            ) : null}
            {workflows.map((w) => (
              <div
                key={w.id}
                className="fx-card fx-card-hover flex items-center gap-2 px-3 py-2.5"
              >
                <span className="truncate text-sm text-fg-primary">{w.title}</span>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {w.hub} · {w.status}
                </span>
                <DeleteWorkflowBtn id={w.id} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading action={deals.length > 0 ? <ClearDealsBtn /> : undefined}>Deal pipeline</SectionHeading>
          {/* Horizontal pipeline shape bar */}
          {deals.length > 0 ? (
            <div className="mb-3 flex h-1.5 overflow-hidden rounded-full bg-surface-3/60">
              {DEAL_STAGES.map((stage) => {
                const count = dealByStage.get(stage) ?? 0;
                const pct = (count / deals.length) * 100;
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
          <div className="grid grid-cols-5 gap-1.5">
            {DEAL_STAGES.map((stage) => {
              const count = dealByStage.get(stage) ?? 0;
              const color = STAGE_COLORS[stage] ?? "#38bdf8";
              return (
                <div
                  key={stage}
                  className="fx-stage-pill group"
                  style={{ "--fx-stage-color": color } as React.CSSProperties}
                >
                  <p
                    className="font-display text-xl font-bold leading-none tracking-tight transition-colors duration-200"
                    style={{ color: count > 0 ? color : undefined }}
                  >
                    {count}
                  </p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-wide text-fg-muted">
                    {stage.replace("_", " ")}
                  </p>
                </div>
              );
            })}
          </div>
          {deals.length === 0 ? (
            <p className="mt-3 text-xs text-fg-muted">
              Deals created by Source-hub workflows appear here.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {deals.slice(0, 5).map((d) => {
                const detail = [d.asset_class, d.geography, compactUsd(d.target_amount)]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-fg-primary">{d.name}</span>
                      {detail ? (
                        <span className="block truncate text-[11px] text-fg-muted">{detail}</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-fg-muted">{d.stage}</span>
                    <DeleteDealBtn id={d.id} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeading action={artifacts.length > 0 ? <ClearArtifactsBtn /> : undefined}>Latest deliverables</SectionHeading>
        {artifacts.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Every workflow step now produces a first-class artifact — IC memos,
            models, risk reports. They land here as Earn runs.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {artifacts.map((a) => (
              <div key={a.id} className="relative">
                <ArtifactCard
                  id={a.id}
                  title={a.title}
                  content={a.content}
                  artifact_type={a.artifact_type}
                  agent={a.agent ?? undefined}
                  created_at={a.created_at ?? undefined}
                  compact
                />
                <div className="absolute right-2 top-2">
                  <DeleteArtifactBtn id={a.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* UX-01: First mission coaching — fires once when org has no workflows. */}
      <FirstMissionCoach isFirstVisit={workflows.length === 0} />
    </div>
  );
}
