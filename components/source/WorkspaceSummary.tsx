"use client";

// What the workspace opens with.
//
// Four numbers, chosen because each one is a question somebody actually asks
// before they start work: what am I late on, what closes soon, who is going
// quiet, and what is nobody holding.
//
// "Going cold" is the one that earns its place in a relationship book rather
// than a sales CRM. A deal that stalls is visible — it sits in a stage and
// somebody notices. A relationship that stalls is invisible by construction:
// nothing happens, so nothing appears anywhere. Counting it is the only way it
// ever surfaces.

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceSummary as Summary } from "@/lib/network-workspace";

interface Props {
  /** Jump to the queue or the calendar when a tile is worth acting on. */
  onOpenTasks?: () => void;
  onOpenCalendar?: () => void;
}

function compactMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`;
  }
}

function Tile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={`font-display text-xl font-semibold tabular-nums ${tone ?? "text-fg-primary"}`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-fg-muted">{hint}</p>}
    </>
  );

  return onClick ? (
    <button
      onClick={onClick}
      className="fx-card flex min-w-[8rem] flex-1 flex-col gap-0.5 px-3 py-2.5 text-left transition hover:border-hairline-strong"
    >
      {body}
    </button>
  ) : (
    <div className="fx-card flex min-w-[8rem] flex-1 flex-col gap-0.5 px-3 py-2.5">{body}</div>
  );
}

export function WorkspaceSummary({ onOpenTasks, onOpenCalendar }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/network/summary");
      const body = (await res.json().catch(() => null)) as
        | { summary?: Summary; error?: string }
        | null;
      if (!res.ok || !body?.summary) throw new Error(body?.error ?? "unavailable");
      setSummary(body.summary);
      setFailed(false);
    } catch {
      // Deliberately NOT falling back to zeroes. "Nothing overdue" and "we
      // could not check" are different facts, and only one of them means
      // somebody can stop worrying about it.
      setFailed(true);
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs text-fg-muted">
        Workspace numbers unavailable — these would be wrong rather than empty.
        <button
          onClick={() => void load()}
          className="ml-auto rounded px-2 py-0.5 hover:text-fg-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!summary) {
    return <div className="h-[4.5rem] animate-pulse rounded-lg border border-hairline" />;
  }

  const closing = summary.closingSoon;

  return (
    <div className="flex flex-wrap gap-2">
      <Tile
        label="Overdue"
        value={String(summary.tasksOverdue)}
        hint={summary.tasksDueToday > 0 ? `${summary.tasksDueToday} due today` : "follow-ups"}
        tone={summary.tasksOverdue > 0 ? "text-rose-300" : undefined}
        onClick={onOpenTasks}
      />

      <Tile
        label="Mine, open"
        value={String(summary.tasksMine)}
        hint={`${summary.tasksDueWeek} due this week`}
        onClick={onOpenTasks}
      />

      {/* One tile per currency. A EUR total added to a USD total is not an
          amount of money in either, so they are never combined. */}
      {closing.length === 0 ? (
        <Tile label="Closing in 30d" value="—" hint="nothing scheduled" onClick={onOpenCalendar} />
      ) : (
        closing.map((bucket) => (
          <Tile
            key={bucket.currency}
            label={`Closing in 30d${closing.length > 1 ? ` · ${bucket.currency}` : ""}`}
            value={compactMoney(bucket.targetTotal, bucket.currency)}
            hint={`${bucket.dealCount} ${bucket.dealCount === 1 ? "deal" : "deals"} · ${compactMoney(
              bucket.weightedTotal,
              bucket.currency,
            )} wtd`}
            tone="text-accent-300"
            onClick={onOpenCalendar}
          />
        ))
      )}

      <Tile
        label="Going cold"
        value={String(summary.contactsCold)}
        hint="live, untouched 90d"
        tone={summary.contactsCold > 0 ? "text-gold-300" : undefined}
      />

      {summary.tasksUnassigned > 0 && (
        <Tile
          label="Unowned"
          value={String(summary.tasksUnassigned)}
          hint="tasks with no assignee"
          onClick={onOpenTasks}
        />
      )}
    </div>
  );
}
