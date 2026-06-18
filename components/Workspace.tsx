"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval, TaskEvent } from "@/lib/supabase/database.types";

interface AgentWorkload {
  key: keyof typeof AGENT_BY_KEY;
  name: string;
  color: string;
  active_tasks: number;
}

export default function Workspace({
  orgId,
  initialTasks,
  pendingApprovals,
  initialEvents,
  agents,
}: {
  orgId: string;
  initialTasks: Task[];
  pendingApprovals: Approval[];
  initialEvents: TaskEvent[];
  agents: AgentWorkload[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [feed, setFeed] = useState<TaskEvent[]>(initialEvents);
  const [isPending, startTransition] = useTransition();

  // Live workspace: subscribe to task_events for this org. RLS guarantees we
  // only receive our own rows. Each event refreshes server data and prepends
  // to the live feed.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`org-${orgId}-events`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_events",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          setFeed((prev) => [payload.new as TaskEvent, ...prev].slice(0, 40));
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  async function submitPrompt(e: React.FormEvent) {
    e.preventDefault();
    const body = prompt.trim();
    if (!body) return;
    setPrompt("");
    await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    startTransition(() => router.refresh());
  }

  async function decide(
    approvalId: string,
    decision: "approved" | "rejected" | "regenerate",
  ) {
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision }),
    });
    startTransition(() => router.refresh());
  }

  const approvalByTask = new Map(pendingApprovals.map((a) => [a.task_id, a]));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Enter a prompt. The Associate routes it to a hub and agent, runs the
          task, and asks for your approval.
        </p>

        <form onSubmit={submitPrompt} className="mt-6 flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Underwrite the Maple Street acquisition…"
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm outline-none focus:border-agent-associate"
          />
          <button
            disabled={isPending}
            className="rounded-md bg-agent-associate px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Run
          </button>
        </form>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Tasks
        </h2>
        <div className="flex flex-col gap-2">
          {initialTasks.length === 0 ? (
            <p className="text-sm text-neutral-600">No tasks yet.</p>
          ) : null}
          {initialTasks.map((task) => {
            const agent = AGENT_BY_KEY[task.assigned_agent];
            const approval = approvalByTask.get(task.id);
            return (
              <div
                key={task.id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: agent?.color }}
                  />
                  <span className="text-sm font-medium">{task.title}</span>
                  <span className="ml-auto rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                    {task.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                  <span>{agent?.name}</span>
                  <span className="capitalize">· {task.hub}</span>
                  <div className="ml-auto h-1.5 w-24 overflow-hidden rounded bg-neutral-800">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.round(task.progress * 100)}%`,
                        backgroundColor: agent?.color,
                      }}
                    />
                  </div>
                </div>
                {approval ? (
                  <div className="mt-3 flex items-center gap-2 border-t border-neutral-800 pt-3">
                    <span className="text-xs text-neutral-400">
                      {approval.summary}
                    </span>
                    <div className="ml-auto flex gap-1.5">
                      <button
                        onClick={() => decide(approval.id, "approved")}
                        className="rounded bg-agent-ops/20 px-2 py-1 text-xs text-green-300 hover:bg-agent-ops/30"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => decide(approval.id, "regenerate")}
                        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() => decide(approval.id, "rejected")}
                        className="rounded bg-agent-diligence/20 px-2 py-1 text-xs text-red-300 hover:bg-agent-diligence/30"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Agents
        </h2>
        <div className="flex flex-col gap-1.5">
          {agents.map((a) => (
            <div
              key={a.key}
              className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: a.color }}
              />
              <span className="text-neutral-300">{a.name}</span>
              {a.active_tasks > 0 ? (
                <span className="ml-auto rounded-full bg-neutral-800 px-2 text-xs text-neutral-400">
                  {a.active_tasks}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Live feed
        </h2>
        <div className="flex flex-col gap-1.5 font-mono text-xs">
          {feed.length === 0 ? (
            <p className="text-neutral-600">Waiting for activity…</p>
          ) : null}
          {feed.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-2 rounded border border-neutral-900 bg-neutral-900/30 px-2 py-1.5"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: ev.agent
                    ? AGENT_BY_KEY[ev.agent]?.color
                    : "#52525b",
                }}
              />
              <span className="text-neutral-400">{ev.event_type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
