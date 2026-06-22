"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  completeMyTeamTask,
  getMyTeamTasks,
  launchTeamTaskWithEarn,
  type TeamTaskSummary,
} from "@/components/copilot/actions";
import type { TaskStatus } from "@/lib/supabase/database.types";

const STATUS_PILL: Partial<Record<TaskStatus, { label: string; cls: string }>> = {
  pending: { label: "ready", cls: "border-neural-400/45 text-neural-300" },
  in_progress: { label: "in progress", cls: "border-status-info/40 text-status-info" },
  blocked: { label: "blocked", cls: "border-status-danger/40 text-status-danger" },
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "text-status-danger",
  high: "text-gold-300",
  normal: "text-fg-muted",
  low: "text-fg-muted",
};

function StatusPill({ status }: { status: TaskStatus }) {
  const pill = STATUS_PILL[status] ?? { label: status.replace(/_/g, " "), cls: "border-line text-fg-muted" };
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${pill.cls}`}>
      {pill.label}
    </span>
  );
}

function dueLabel(dueAt: string | null): string | null {
  if (!dueAt) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(dueAt));
  } catch {
    return null;
  }
}

export function TeamTasksFeed({
  open,
  pathname,
}: {
  open: boolean;
  pathname: string;
}) {
  const [tasks, setTasks] = useState<TeamTaskSummary[] | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(() => getMyTeamTasks().then((items) => setTasks(items)), []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getMyTeamTasks().then((items) => {
      if (active) setTasks(items);
    });
    return () => {
      active = false;
    };
  }, [open]);

  function complete(taskId: string) {
    const fd = new FormData();
    fd.set("team_task_id", taskId);
    start(async () => {
      await completeMyTeamTask(fd);
      await refresh();
    });
  }

  if (!tasks || tasks.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-neural-300">Your tasks</p>
        <Link href="/build/team" className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-neural-300">
          Assign →
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => {
          const due = dueLabel(task.dueAt);
          return (
            <div key={task.id} className="rounded-xl border border-neural-400/15 bg-black/55 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg-primary">{task.title}</p>
                  {task.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">{task.description}</p>
                  ) : null}
                </div>
                <StatusPill status={task.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider">
                <span className={PRIORITY_CLASS[task.priority] ?? "text-fg-muted"}>{task.priority}</span>
                {task.hub ? <span className="text-fg-muted">{task.hub}{task.module ? ` / ${task.module.replace(/_/g, " ")}` : ""}</span> : null}
                {due ? <span className="text-fg-muted">Due {due}</span> : null}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <form action={launchTeamTaskWithEarn}>
                  <input type="hidden" name="team_task_id" value={task.id} />
                  <input type="hidden" name="pathname" value={pathname} />
                  <button
                    disabled={pending}
                    className="rounded-md bg-neural-400 px-2.5 py-1 text-[11px] font-medium text-black transition hover:bg-neural-300 disabled:opacity-50"
                  >
                    Run with Earn
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => complete(task.id)}
                  disabled={pending}
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:border-status-success/40 hover:text-status-success disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
