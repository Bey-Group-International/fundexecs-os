"use client";

// The work queue — every open follow-up across the whole book.
//
// Tasks have existed since the CRM spine, but the only place they surfaced was
// one contact's record. That means the work was already written down and still
// unfindable: you had to know which relationship to open before you could see
// what you owed it. This is the other half — the same rows, read by urgency
// instead of by person.
//
// Completing a task is optimistic and reverts on failure, like every other
// write in this workspace. A checkbox that ticks and then silently un-ticks on
// the next refresh is how somebody stops trusting the list.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BUCKET_LABEL,
  groupTaskQueue,
  type QueueTask,
  type TaskBucket,
} from "@/lib/network-workspace";

type AssigneeFilter = "me" | "all" | "unassigned";

interface Props {
  owners?: { id: string; name: string }[];
}

const BUCKET_TONE: Record<TaskBucket, string> = {
  overdue: "text-rose-300",
  today: "text-gold-300",
  week: "text-fg-primary",
  later: "text-fg-secondary",
  someday: "text-fg-muted",
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-400",
  normal: "bg-fg-muted/50",
  low: "bg-fg-muted/25",
};

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "No date";
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) return "No date";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TaskQueue({ owners = [] }: Props) {
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [assignee, setAssignee] = useState<AssigneeFilter>("me");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: "open", limit: "200" });
      if (assignee !== "all") params.set("assignee", assignee);
      const res = await fetch(`/api/network/tasks?${params}`);
      const body = (await res.json().catch(() => null)) as
        | { tasks?: QueueTask[]; error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load the queue.");
      setTasks(body?.tasks ?? []);
      setError(null);
    } catch (err) {
      // An empty queue and an unreachable one are different claims; only one of
      // them means you are done for the day.
      setError(err instanceof Error ? err.message : "Couldn't load the queue.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [assignee]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = useCallback(
    async (task: QueueTask) => {
      setPending((p) => new Set(p).add(task.id));
      // Optimistic: it leaves the list at once. A queue that lags behind the
      // tick makes people click twice.
      setTasks((prev) => prev.filter((t) => t.id !== task.id));

      try {
        const res = await fetch(`/api/network/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? "Couldn't complete that.");
        setError(null);
      } catch (err) {
        // Put back exactly the one task, not a whole snapshot: other rows may
        // have been completed while this request was in flight.
        setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
        setError(err instanceof Error ? err.message : "Couldn't complete that.");
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(task.id);
          return next;
        });
      }
    },
    [],
  );

  const groups = useMemo(() => groupTaskQueue(tasks), [tasks]);
  const overdueCount = groups.find((g) => g.bucket === "overdue")?.tasks.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-fg-secondary">
          <span className="font-display text-lg font-semibold tabular-nums text-fg-primary">
            {tasks.length}
          </span>{" "}
          open {tasks.length === 1 ? "task" : "tasks"}
          {overdueCount > 0 && (
            <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-300">
              {overdueCount} overdue
            </span>
          )}
        </p>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-hairline p-0.5">
          {(["me", "all", "unassigned"] as AssigneeFilter[]).map((value) => (
            <button
              key={value}
              onClick={() => setAssignee(value)}
              aria-pressed={assignee === value}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                assignee === value
                  ? "bg-fg-primary/10 text-fg-primary"
                  : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              {value === "me" ? "Mine" : value === "all" ? "Everyone" : "Unassigned"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
          <button
            onClick={() => void load()}
            className="ml-auto rounded px-2 py-0.5 text-fg-muted hover:text-fg-primary"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="fx-card p-8 text-center text-sm text-fg-muted">Loading the queue…</div>
      ) : groups.length === 0 && !error ? (
        <div className="fx-card p-8 text-center">
          <p className="text-sm font-medium text-fg-primary">Nothing open</p>
          <p className="mt-1 text-xs text-fg-muted">
            {assignee === "me"
              ? "No follow-ups assigned to you."
              : assignee === "unassigned"
                ? "Every task has an owner."
                : "No open follow-ups anywhere in the book."}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.bucket} className="flex flex-col gap-1.5">
            <h3
              className={`text-xs font-semibold uppercase tracking-wide ${BUCKET_TONE[group.bucket]}`}
            >
              {BUCKET_LABEL[group.bucket]}
              <span className="ml-2 font-mono text-[11px] font-normal tabular-nums text-fg-muted">
                {group.tasks.length}
              </span>
            </h3>

            <ul className="flex flex-col gap-1">
              {group.tasks.map((task) => {
                const busy = pending.has(task.id);
                return (
                  <li
                    key={task.id}
                    className="fx-card flex items-start gap-3 px-3 py-2.5 transition hover:border-hairline-strong"
                  >
                    <button
                      onClick={() => void complete(task)}
                      disabled={busy}
                      aria-label={`Mark "${task.title}" done`}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border border-hairline-strong transition hover:border-accent-300 hover:bg-accent-300/20 disabled:opacity-40"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">{task.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
                        <span className={group.bucket === "overdue" ? "text-rose-300" : undefined}>
                          {dueLabel(task.dueAt)}
                        </span>
                        {task.contactName && (
                          <>
                            <span aria-hidden>·</span>
                            {task.contactId ? (
                              <Link
                                href={`/network/${task.contactId}`}
                                className="truncate hover:text-fg-secondary hover:underline"
                              >
                                {task.contactName}
                              </Link>
                            ) : (
                              <span className="truncate">{task.contactName}</span>
                            )}
                          </>
                        )}
                        {task.opportunityName && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate text-accent-300/80">
                              {task.opportunityName}
                            </span>
                          </>
                        )}
                        {task.assigneeName && assignee !== "me" && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate">{task.assigneeName}</span>
                          </>
                        )}
                      </p>
                    </div>

                    <span
                      aria-hidden
                      title={`${task.priority} priority`}
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal
                      }`}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {owners.length > 0 && assignee === "unassigned" && !loading && tasks.length > 0 && (
        <p className="text-[11px] text-fg-muted">
          Open a task from its contact record to give it an owner.
        </p>
      )}
    </div>
  );
}
