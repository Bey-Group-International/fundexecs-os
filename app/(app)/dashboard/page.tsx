import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/agents";
import type { Task, Deal, Asset, Artifact, AgentKey } from "@/lib/supabase/database.types";
import { seedDemoData, clearDemoData } from "./actions";
import { SessionsSection } from "./SessionsSection";
import { MissionControl } from "@/components/dashboard/MissionControl";
import { HottestCapital, PendingGates } from "./CapitalSignals";
import { Outbox } from "./Outbox";
import type { Session, SessionGroup, Approval, DispatchLog } from "@/lib/supabase/database.types";
import { ArtifactCard } from "@/components/ArtifactViewer";
import { buildCapitalMap } from "@/lib/capital-map";
import { getBuildReadiness } from "@/lib/build-readiness";
import { getInboxThreads } from "@/lib/inbox/data";
import { buildDigest, priorityBucket, type DigestThread } from "@/lib/inbox/intelligence";
import { channelMeta } from "@/lib/inbox/channels";

export const dynamic = "force-dynamic";

const AGENT_GROUPS: { label: string; keys: AgentKey[] }[] = [
  { label: "Research", keys: ["analyst", "diligence"] },
  { label: "Workflow", keys: ["associate", "investor_relations"] },
  { label: "Execution", keys: ["portfolio_ops", "fund_admin"] },
];

const ACTIVE = new Set(["pending", "in_progress", "awaiting_approval", "blocked"]);
const DEAL_STAGES = ["sourced", "screening", "diligence", "ic_review", "closing"] as const;

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
    <div className="fx-card fx-card-hover group relative overflow-hidden p-4">
      {/* Top-edge gold hairline that brightens on hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/40 to-transparent transition-opacity duration-200 group-hover:via-gold-400/70"
      />
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1.5 font-display text-3xl font-semibold leading-none tracking-tight text-fg-primary">
        {value}
      </p>
    </div>
  );
}

// Standardized section heading — a short gold tick before a mono-cased label,
// with an optional trailing action. Gives the Command Center a consistent
// rhythm down the page.
function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
        <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
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

  const supabase = createServerClient();
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
    supabase.from("deals").select("*").order("created_at", { ascending: false }).limit(8),
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
      <header className="fx-glass mb-6 flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            <span aria-hidden className="h-4 w-1 rounded-full bg-gradient-to-b from-gold-300 to-gold-500" />
            Command Center
          </span>
          <h1 className="mt-2.5 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
            Private Markets Command Center
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">
            Everything Earn produces, organized into a blue-lit operating surface for deal flow,
            capital, approvals, and deliverables.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Day/night ready", "Desktop optimized", "Mobile compact", "App-safe spacing"].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-gold-500/25 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <form action={seedDemoData}>
            <button className="rounded-lg bg-gold-500 px-3.5 py-2 text-xs font-medium text-surface-0 shadow-[0_10px_24px_-14px_rgb(var(--fx-accent-rgb)/0.85)] transition hover:bg-gold-400 hover:shadow-[0_12px_28px_-14px_rgb(var(--fx-accent-rgb)/0.95)]">
              Load demo data
            </button>
          </form>
          <form action={clearDemoData}>
            <button className="rounded-lg border border-line px-3.5 py-2 text-xs text-fg-secondary transition hover:border-line/0 hover:bg-surface-2 hover:text-fg-primary">
              Reset
            </button>
          </form>
        </div>
      </header>

      {/* Mission control — each hub's headline signal + next-best action. */}
      <div className="mb-6">
        <MissionControl orgId={ctx.orgId} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Workflows" value={workflows.length} />
        <Stat label="Deliverables" value={stepsCompleted} />
        <Stat label="Deals in pipeline" value={deals.length} />
        <Stat label="Portfolio assets" value={assets.length} />
      </section>

      <Link
        href="/build"
        className="fx-card fx-card-hover mt-3 flex items-center gap-4 p-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Foundation readiness
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
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
                {group.label}
              </p>
              <div className="flex flex-col gap-2.5">
                {group.keys.map((key) => {
                  const agent = AGENTS.find((a) => a.key === key)!;
                  const count = workload.get(key) ?? 0;
                  const active = count > 0;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${active ? "animate-pulse" : ""}`}
                        style={{
                          backgroundColor: agent.color,
                          boxShadow: active ? `0 0 8px ${agent.color}` : "none",
                        }}
                      />
                      <span className="text-sm text-fg-primary">{agent.name}</span>
                      <span
                        className={`ml-auto font-mono text-[10px] ${active ? "text-gold-300" : "text-fg-muted"}`}
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
          <SectionHeading>Recent workflows</SectionHeading>
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
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading>Deal pipeline</SectionHeading>
          <div className="grid grid-cols-5 gap-1.5">
            {DEAL_STAGES.map((stage) => (
              <div key={stage} className="fx-card p-2 text-center">
                <p className="font-display text-lg font-semibold text-fg-primary">
                  {dealByStage.get(stage) ?? 0}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-wide text-fg-muted">
                  {stage.replace("_", " ")}
                </p>
              </div>
            ))}
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
                  <div key={d.id} className="flex items-baseline gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="block truncate text-fg-primary">{d.name}</span>
                      {detail ? (
                        <span className="block truncate text-[11px] text-fg-muted">{detail}</span>
                      ) : null}
                    </div>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">{d.stage}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeading>Latest deliverables</SectionHeading>
        {artifacts.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Every workflow step now produces a first-class artifact — IC memos,
            models, risk reports. They land here as Earn runs.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {artifacts.map((a) => (
              <ArtifactCard
                key={a.id}
                id={a.id}
                title={a.title}
                content={a.content}
                artifact_type={a.artifact_type}
                agent={a.agent ?? undefined}
                created_at={a.created_at ?? undefined}
                compact
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
