import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/agents";
import type { Task, Deal, Asset, Artifact, ArtifactType, AgentKey } from "@/lib/supabase/database.types";
import { seedDemoData, clearDemoData } from "./actions";
import { SessionsSection } from "./SessionsSection";
import type { Session, SessionGroup } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const ARTIFACT_LABEL: Record<ArtifactType, string> = {
  ic_memo: "IC Memo",
  model: "Model",
  analysis: "Analysis",
  risk_report: "Risk Report",
  lp_update: "LP Update",
  memo: "Memo",
  summary: "Summary",
  other: "Deliverable",
};

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
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-fg-primary">{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const [allTasksRes, workflowsRes, dealsRes, assetsRes, artifactsRes, sessionsRes, groupsRes] =
    await Promise.all([
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
    ]);

  const tasks = (allTasksRes.data ?? []) as Task[];
  const workflows = (workflowsRes.data ?? []) as Task[];
  const deals = (dealsRes.data ?? []) as Deal[];
  const assets = (assetsRes.data ?? []) as Asset[];
  const artifacts = (artifactsRes.data ?? []) as Artifact[];
  const sessions = (sessionsRes.data ?? []) as Session[];
  const sessionGroups = (groupsRes.data ?? []) as SessionGroup[];

  const stepsCompleted = tasks.filter((t) => t.parent_task_id && t.status === "completed").length;
  const workload = new Map<AgentKey, number>();
  for (const t of tasks) {
    if (ACTIVE.has(t.status)) workload.set(t.assigned_agent, (workload.get(t.assigned_agent) ?? 0) + 1);
  }
  const dealByStage = new Map<string, number>();
  for (const d of deals) dealByStage.set(d.stage, (dealByStage.get(d.stage) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            Command Center
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
            Private Markets Command Center
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Everything Earn produces, organized.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <form action={seedDemoData}>
            <button className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-gold-400">
              Load demo data
            </button>
          </form>
          <form action={clearDemoData}>
            <button className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
              Reset
            </button>
          </form>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Workflows" value={workflows.length} />
        <Stat label="Deliverables" value={stepsCompleted} />
        <Stat label="Deals in pipeline" value={deals.length} />
        <Stat label="Portfolio assets" value={assets.length} />
      </section>

      <SessionsSection sessions={sessions} groups={sessionGroups} />

      <section className="mt-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
          AI Agent Workforce
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {AGENT_GROUPS.map((group) => (
            <div key={group.label} className="rounded-xl border border-line bg-surface-1 p-4">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
                {group.label}
              </p>
              <div className="flex flex-col gap-2.5">
                {group.keys.map((key) => {
                  const agent = AGENTS.find((a) => a.key === key)!;
                  const count = workload.get(key) ?? 0;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: agent.color }} />
                      <span className="text-sm text-fg-primary">{agent.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-fg-muted">
                        {count > 0 ? `${count} active` : "idle"}
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
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
            Recent workflows
          </h2>
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
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2"
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
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
            Deal pipeline
          </h2>
          <div className="grid grid-cols-5 gap-1.5">
            {DEAL_STAGES.map((stage) => (
              <div key={stage} className="rounded-lg border border-line bg-surface-1 p-2 text-center">
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
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
          Latest deliverables
        </h2>
        {artifacts.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Every workflow step now produces a first-class artifact — IC memos,
            models, risk reports. They land here as Earn runs.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {artifacts.map((a) => (
              <div key={a.id} className="rounded-lg border border-line bg-surface-1 p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                    {ARTIFACT_LABEL[a.artifact_type]}
                  </span>
                  <span className="truncate text-sm text-fg-primary">{a.title}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-fg-muted">
                  {a.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
