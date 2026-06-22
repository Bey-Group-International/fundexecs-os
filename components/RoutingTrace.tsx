"use client";

import { useState } from "react";
import { buildRoutingTrace, type TraceState } from "@/lib/routing-trace";
import type { Task, Approval } from "@/lib/supabase/database.types";

// The routing trace — WHEN and WHERE a request was routed, made legible.
// Collapsed it's a one-line path; expanded it's a timestamped stepper:
// Intent → Engine → Hub → Desk → Gate. Read-only; the operator re-routes from
// the card's "Re-route" control, not here.

function fmtTime(at: string | null): string {
  if (!at) return "—";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const DOT: Record<TraceState, string> = {
  done: "bg-gold-400",
  active: "bg-status-info",
  pending: "border border-line bg-transparent",
};

export function RoutingTrace({
  bundle,
}: {
  bundle: { workflow: Task; steps: Task[]; approval: Approval | null };
}) {
  const [open, setOpen] = useState(false);
  const nodes = buildRoutingTrace(bundle);
  const compact = nodes.map((n) => n.value).join(" · ");

  return (
    <div className="rounded-xl border border-line/65 bg-surface-0/35">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Route</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-wider text-gold-300">
          {compact}
        </span>
        <span className={`shrink-0 font-mono text-[9px] text-fg-muted transition ${open ? "rotate-90" : ""}`} aria-hidden>
          ▸
        </span>
      </button>

      {open ? (
        <ol className="space-y-0 border-t border-line/55 px-3 py-2">
          {nodes.map((n, i) => (
            <li key={n.key} className="flex gap-2.5">
              {/* Rail: dot + connector line between legs. */}
              <div className="flex flex-col items-center">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[n.state]}`} />
                {i < nodes.length - 1 ? <span className="w-px flex-1 bg-line/60" /> : null}
              </div>
              <div className="min-w-0 flex-1 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{n.label}</span>
                  <span className="shrink-0 font-mono text-[9px] text-fg-muted">{fmtTime(n.at)}</span>
                </div>
                <p className="truncate text-xs text-fg-primary">
                  {n.value}
                  {n.detail ? <span className="text-fg-muted"> · {n.detail}</span> : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
