import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/agents";
import { HUBS } from "@/lib/hubs";
import type { AgentKey } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const HUB_ICONS: Record<string, string> = {
  build: "◈",
  source: "◎",
  run: "◉",
  execute: "◆",
};

const HUB_CTA: Record<string, string> = {
  build: "Set up your firm profile",
  source: "Add your first deal",
  run: "Start a diligence memo",
  execute: "Log a capital event",
};

export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const [tasks, approvals, events] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("approvals").select("*").eq("decision", "pending"),
    supabase
      .from("task_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const activeStatuses = new Set(["pending", "in_progress", "awaiting_approval", "blocked"]);
  const workload = new Map<AgentKey, number>();
  for (const t of tasks.data ?? []) {
    if (activeStatuses.has(t.status)) {
      workload.set(t.assigned_agent, (workload.get(t.assigned_agent) ?? 0) + 1);
    }
  }

  const totalTasks = tasks.data?.length ?? 0;
  const pendingApprovals = approvals.data?.length ?? 0;
  const activeTasks = tasks.data?.filter((t) => activeStatuses.has(t.status)).length ?? 0;

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Workspace</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Your private-markets operating system. Four hubs. Six agents.
        </p>
      </div>

      {/* Summary strip */}
      <div className="mb-8 grid grid-cols-3 gap-3">
        {[
          { label: "Active tasks", value: activeTasks || "—" },
          { label: "Pending approvals", value: pendingApprovals || "—", highlight: pendingApprovals > 0 },
          { label: "Total tasks", value: totalTasks || "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl border px-5 py-4 ${
              stat.highlight
                ? "border-agent-associate/30 bg-agent-associate/5"
                : "border-white/5 bg-white/[0.02]"
            }`}
          >
            <p className={`text-2xl font-semibold ${stat.highlight ? "text-agent-associate" : "text-white"}`}>
              {stat.value}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Hub cards */}
      <div className="mb-8">
        <p className="mb-3 font-mono text-xs uppercase tracking-wider text-neutral-600">Hubs</p>
        <div className="grid grid-cols-2 gap-3">
          {HUBS.map((hub) => (
            <div
              key={hub.key}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-5 transition hover:border-agent-associate/20 hover:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-lg text-agent-associate">{HUB_ICONS[hub.key]}</span>
                  <h3 className="mt-1.5 font-medium text-white">{hub.label}</h3>
                  <p className="mt-0.5 text-xs text-neutral-500">{hub.purpose}</p>
                </div>
                <span className="rounded-md border border-white/5 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">
                  {hub.modules.length} modules
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {hub.modules.slice(0, 3).map((m) => (
                    <span key={m.key} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-500">
                      {m.label}
                    </span>
                  ))}
                  {hub.modules.length > 3 && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-600">
                      +{hub.modules.length - 3}
                    </span>
                  )}
                </div>
                <a
                  href={`/${hub.key}`}
                  className="text-xs text-agent-associate hover:underline"
                >
                  {HUB_CTA[hub.key]} →
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent status + activity */}
      <div className="grid grid-cols-3 gap-3">
        {/* Agent strip */}
        <div className="col-span-1 rounded-xl border border-white/5 bg-white/[0.02] p-5">
          <p className="mb-3 font-mono text-xs uppercase tracking-wider text-neutral-600">Agents</p>
          <div className="flex flex-col gap-3">
            {AGENTS.map((agent) => {
              const count = workload.get(agent.key) ?? 0;
              return (
                <div key={agent.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${count > 0 ? "" : "opacity-25"}`}
                      style={{ backgroundColor: agent.color }}
                    />
                    <span className="text-xs text-neutral-400">{agent.name}</span>
                  </div>
                  {count > 0 ? (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
                      {count}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-neutral-700">idle</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent activity */}
        <div className="col-span-2 rounded-xl border border-white/5 bg-white/[0.02] p-5">
          <p className="mb-3 font-mono text-xs uppercase tracking-wider text-neutral-600">
            Recent activity
          </p>
          {(events.data ?? []).length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <p className="text-sm text-neutral-600">No activity yet.</p>
              <p className="mt-1 text-xs text-neutral-700">
                Your agent workflows will appear here as they run.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(events.data ?? []).slice(0, 6).map((ev: any) => (
                <div key={ev.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-agent-associate opacity-60" />
                    <span className="text-xs text-neutral-400">{ev.event_type}</span>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-700">
                    {new Date(ev.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
