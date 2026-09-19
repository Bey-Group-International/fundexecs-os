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

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSummary as Summary } from "@/lib/network-workspace";

interface Props {
  /** Jump to the queue or the calendar when a tile is worth acting on. */
  onOpenTasks?: () => void;
  onOpenCalendar?: () => void;
}

/** Money in a compact form (£1.2M), falling back to a plain figure rather than
 *  blanking the cell when the currency code is one Intl does not know. */
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

/** One number with its label, rendered as a button when there is somewhere to go. */
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

/**
 * The strip of numbers the workspace opens with.
 *
 * Renders nothing but an "unavailable" notice when the read fails: falling back
 * to zeroes would turn "we could not check" into "nothing is overdue", which is
 * the one error here that makes somebody stop worrying.
 */
export function WorkspaceSummary({ onOpenTasks, onOpenCalendar }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  // Retry is a button, and buttons get clicked twice. The other three loaders
  // in this workspace already order their reads; this one did not, so an older
  // response could overwrite a newer one — including an old failure landing on
  // top of a fresh success, which would claim the numbers are unavailable when
  // they had just arrived.
  const latestRead = useRef(0);

  const load = useCallback(async () => {
    const seq = ++latestRead.current;
    setLoading(true);
    try {
      const res = await fetch("/api/network/summary");
      const body = (await res.json().catch(() => null)) as
        | { summary?: Summary; error?: string }
        | null;
      if (!res.ok || !body?.summary) throw new Error(body?.error ?? "unavailable");
      if (seq !== latestRead.current) return;
      setSummary(body.summary);
      setFailed(false);
    } catch {
      if (seq !== latestRead.current) return;
      // Deliberately NOT falling back to zeroes. "Nothing overdue" and "we
      // could not check" are different facts, and only one of them means
      // somebody can stop worrying about it.
      setFailed(true);
      setSummary(null);
    } finally {
      if (seq === latestRead.current) setLoading(false);
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
          disabled={loading}
          className="ml-auto rounded px-2 py-0.5 hover:text-fg-primary disabled:opacity-50"
        >
          {loading ? "Checking…" : "Retry"}
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
      {/* Each tile states whose work it counts. The week figure used to sit
          under "Mine, open" as though it were a subset of it, but it counts the
          whole book — so a person with four open tasks could read "4 open, 9
          due this week" and have no way to tell that six of them were somebody
          else's. A number that cannot be a subset must not be printed as one. */}
      <Tile
        label="Overdue"
        value={String(summary.tasksOverdue)}
        hint={summary.tasksDueToday > 0 ? `${summary.tasksDueToday} due today` : "across the book"}
        tone={summary.tasksOverdue > 0 ? "text-rose-300" : undefined}
        onClick={onOpenTasks}
      />

      <Tile
        label="Due in 7 days"
        value={String(summary.tasksDueWeek)}
        hint="across the book"
        onClick={onOpenTasks}
      />

      <Tile
        label="Mine, open"
        value={String(summary.tasksMine)}
        hint="assigned to you"
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

      {/* The counterweight to "going cold": what the book actually did this
          week. It was computed and carried all the way through the summary
          contract without ever being drawn, which is the same gap this phase
          existed to close everywhere else. */}
      <Tile
        label="Logged, 7d"
        value={String(summary.activitiesWeek)}
        hint="calls, notes, meetings"
      />

      {/* Only when there are any. A deal past its expected close is late, not
          imminent, so it is counted here rather than folded into the window
          above — where, before it was bounded, a deal that missed its date two
          years ago was still being reported as closing within the month. */}
      {summary.closesOverdue > 0 && (
        <Tile
          label="Past close date"
          value={String(summary.closesOverdue)}
          hint="open, date already gone"
          tone="text-rose-300"
          onClick={onOpenCalendar}
        />
      )}

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
