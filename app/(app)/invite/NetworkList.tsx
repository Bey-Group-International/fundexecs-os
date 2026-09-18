"use client";

import { useState } from "react";
import type { DownlineRow } from "@/lib/gift-earn";

const LEVEL_LABEL: Record<number, string> = { 1: "Direct", 2: "2nd level", 3: "3rd level" };

// How many rows render before the list asks to be expanded. A network of a few
// hundred firms is a success story, not a reason to paint a few hundred rows
// nobody scrolls to; the counts in the header come from the summary totals, so
// they stay right whether or not the rest is on screen.
const VISIBLE = 25;

export function NetworkList({
  rows,
  totalDownline,
  directCount,
}: {
  rows: DownlineRow[];
  totalDownline: number;
  directCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  const hidden = rows.length - shown.length;

  return (
    <div className="overflow-hidden rounded-2xl border border-neural-400/20 bg-surface-0/85 shadow-[0_1px_2px_rgb(15_23_42/0.10)]">
      <div className="flex items-center justify-between border-b border-neural-400/15 px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
          {totalDownline} firm{totalDownline !== 1 ? "s" : ""} in network
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          {directCount} direct
        </p>
      </div>
      <div className="divide-y divide-neural-400/10">
        {shown.map((row) => (
          <div
            key={row.orgId}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-1/40"
          >
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                row.level === 1
                  ? "border-gold-400/50 bg-gold-400/10 text-gold-300 shadow-[0_0_8px_rgb(var(--fx-gold-rgb)/0.25)]"
                  : row.level === 2
                  ? "border-neural-400/40 bg-neural-400/10 text-neural-300"
                  : "border-line/60 bg-surface-2/40 text-fg-muted"
              }`}
            >
              {LEVEL_LABEL[row.level] ?? `L${row.level}`}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">{row.name}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                row.status === "subscribed"
                  ? "bg-status-success/15 text-status-success"
                  : row.status === "joined"
                  ? "bg-neural-400/10 text-neural-300"
                  : "bg-surface-2/40 text-fg-muted"
              }`}
            >
              {row.status}
            </span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-neural-400/15 px-4 py-3 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300 transition hover:bg-surface-1/40"
        >
          Show all {rows.length} firms
        </button>
      )}
    </div>
  );
}
