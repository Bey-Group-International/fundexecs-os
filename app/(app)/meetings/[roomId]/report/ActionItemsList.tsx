"use client";

// The report's action items, as the tasks they became.
//
// They used to be text with a "☐" in front: something that looked tickable and
// was not, on a page the host returns to precisely to see what is still owed.
// Each item is already a task on somebody's list; this shows whose, when it is
// due, and lets the host — or the person it is for — tick it off from here.
import { useState } from "react";
import type { ReportActionItem } from "@/lib/meetings/report-participants";

function dueLabel(iso: string): { text: string; overdue: boolean } {
  const due = new Date(iso);
  const text = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { text: `Due ${text}`, overdue: due.getTime() < Date.now() };
}

export function ActionItemsList({
  meetingId,
  items,
  viewerId,
  isHost,
}: {
  meetingId: string;
  items: ReportActionItem[];
  viewerId: string | null;
  isHost: boolean;
}) {
  const [done, setDone] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(items.map((item, i) => [i, item.done])),
  );
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completed = items.filter((_, i) => done[i]).length;

  async function toggle(i: number) {
    const item = items[i];
    if (!item.taskId) return;
    const next = !done[i];
    setDone((d) => ({ ...d, [i]: next }));
    setPending(i);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/action-items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: item.taskId, done: next }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setDone((d) => ({ ...d, [i]: !next }));
        setError(json.error ?? "That item could not be updated.");
      }
    } catch {
      setDone((d) => ({ ...d, [i]: !next }));
      setError("That item could not be updated. Check your connection.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">Action items</h2>
        <span className="text-xs text-[var(--fg-muted)]">
          {completed} of {items.length} done
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item, i) => {
          const checked = Boolean(done[i]);
          const canToggle =
            Boolean(item.taskId) && (isHost || (viewerId !== null && item.assignedTo === viewerId));
          const due = item.dueAt ? dueLabel(item.dueAt) : null;
          const id = `action-item-${i}`;
          return (
            <li
              key={i}
              className={`flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 transition-opacity ${
                checked ? "opacity-60" : ""
              }`}
            >
              <input
                id={id}
                type="checkbox"
                checked={checked}
                disabled={!canToggle || pending === i}
                onChange={() => void toggle(i)}
                title={
                  !item.taskId
                    ? "No task was created for this item"
                    : canToggle
                      ? checked
                        ? "Mark as not done"
                        : "Mark as done"
                      : "Only the host or the person it is for can tick this off"
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--gold-400)] disabled:cursor-not-allowed"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label
                  htmlFor={id}
                  className={`text-sm text-[var(--fg-primary)] ${checked ? "line-through" : ""} ${
                    canToggle ? "cursor-pointer" : ""
                  }`}
                >
                  {item.task}
                </label>
                {(item.owner || due) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.owner && (
                      <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] text-[var(--fg-secondary)]">
                        {item.owner}
                      </span>
                    )}
                    {due && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          due.overdue && !checked
                            ? "bg-[var(--status-danger,#ef4444)]/15 text-[var(--status-danger,#ef4444)]"
                            : "bg-[var(--surface-3)] text-[var(--fg-secondary)]"
                        }`}
                      >
                        {due.text}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-xs text-[var(--status-danger,#ef4444)]">
          {error}
        </p>
      )}
    </section>
  );
}
