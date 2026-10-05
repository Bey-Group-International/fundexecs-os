"use client";

// The report's action items, as the tasks they became.
//
// They used to be text with a "☐" in front: something that looked tickable and
// was not, on a page the host returns to precisely to see what is still owed.
// Each item is already a task on somebody's list; this shows whose, when it is
// due, and lets the host — or the person it is for — tick it off from here.
import { useMemo, useState } from "react";
import { commitmentsByPerson } from "@/lib/meetings/report-insights";
import type { ReportActionItem } from "@/lib/meetings/report-participants";
import { MomentChip } from "./MomentChip";

function dueLabel(iso: string): { text: string; overdue: boolean } {
  const due = new Date(iso);
  const text = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { text: `Due ${text}`, overdue: due.getTime() < Date.now() };
}

export function ActionItemsList({
  meetingId,
  items,
  moments,
  viewerId,
  isHost,
}: {
  meetingId: string;
  items: ReportActionItem[];
  /** Where each item was said, by index; null where no moment was found. */
  moments?: ReadonlyArray<number | null>;
  viewerId: string | null;
  isHost: boolean;
}) {
  const [done, setDone] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(items.map((item, i) => [i, item.done])),
  );
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completed = items.filter((_, i) => done[i]).length;
  const [view, setView] = useState<"list" | "person">("list");
  const groups = useMemo(() => commitmentsByPerson(items), [items]);

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

  // One item's row, the same in either view: the list in the report's own
  // order, or grouped by who owns it.
  function renderItem(item: ReportActionItem, i: number) {
          const checked = Boolean(done[i]);
          const canToggle =
            Boolean(item.taskId) && (isHost || (viewerId !== null && item.assignedTo === viewerId));
          const due = item.dueAt ? dueLabel(item.dueAt) : null;
          const id = `action-item-${i}`;
          const at = moments?.[i] ?? null;
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
                {(item.owner || due || at !== null) && (
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
                    {at !== null && <MomentChip ms={at} what="this action item" />}
                  </div>
                )}
              </div>
            </li>
          );
        }

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">Action items</h2>
        <div className="flex items-center gap-3">
          {/* By person only helps when there is more than one person: the
              list of what each owner took away, ready to read down or send. */}
          {groups.length > 1 && (
            <div role="group" aria-label="Show action items" className="inline-flex rounded-lg border border-[var(--line)] p-0.5">
              {(["list", "person"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`min-h-8 rounded-md px-2.5 text-[11px] font-medium sm:min-h-7 ${
                    view === v ? "bg-[var(--surface-3)] text-[var(--fg-primary)]" : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
                  }`}
                >
                  {v === "list" ? "List" : "By person"}
                </button>
              ))}
            </div>
          )}
          <span className="text-xs text-[var(--fg-muted)]">
            {completed} of {items.length} done
          </span>
        </div>
      </div>

      {view === "person" ? (
        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            const groupDone = group.items.filter(({ index }) => done[index]).length;
            return (
              <div key={group.owner ?? "—"} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-medium text-[var(--fg-primary)]">{group.owner ?? "Not assigned"}</h3>
                  <span className="text-[11px] tabular-nums text-[var(--fg-muted)]">
                    {groupDone} of {group.items.length} done
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {group.items.map(({ item, index }) => renderItem(item, index))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">{items.map((item, i) => renderItem(item, i))}</ul>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--status-danger,#ef4444)]">
          {error}
        </p>
      )}
    </section>
  );
}
