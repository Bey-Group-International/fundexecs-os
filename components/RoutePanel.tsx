"use client";

import { useState } from "react";
import { RerouteControl } from "@/components/grid/RerouteControl";
import { EXECUTIVES, EXECUTIVE_LABEL, type Executive, type TargetEngine } from "@/lib/intelligence";

// Unified Delegate & Route — one place to override Earn's auto-routing along
// either axis:
//   • Engine — re-classify the workflow into a different execution engine
//     (logged to operator_feedback for the learning loop; see RerouteControl).
//   • Desk   — delegate the work to a different executive desk, which re-plans
//     it (only while a decision is pending, since it rebuilds the plan).
// Replaces the two separate re-route controls that previously sat on the card.
export function RoutePanel({
  workflowId,
  currentEngine,
  currentDesk,
  canDelegate,
  busy,
  onDelegate,
}: {
  workflowId: string;
  currentEngine: TargetEngine;
  currentDesk: Executive;
  // Desk delegation re-plans the work, so it's only offered before approval.
  canDelegate: boolean;
  busy: boolean;
  onDelegate: (desk: Executive) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Re-route — change the engine or delegate to a different desk"
        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
      >
        <span className={`transition ${open ? "rotate-90" : ""}`} aria-hidden>▸</span>
        Re-route
      </button>

      {open ? (
        <div className="mt-2 space-y-3 rounded-xl border border-line/70 bg-surface-0/40 p-3">
          {/* Engine axis — always available; re-classifies + teaches the router. */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Engine</p>
              <p className="mt-0.5 text-[11px] text-fg-muted">Re-classify the execution engine.</p>
            </div>
            <RerouteControl workflowId={workflowId} currentEngine={currentEngine} />
          </div>

          {/* Desk axis — delegate ownership; re-plans, so only before approval. */}
          <div className="border-t border-line/55 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Desk</p>
            {canDelegate ? (
              <>
                <p className="mt-0.5 text-[11px] text-fg-muted">
                  Earn routed this to {EXECUTIVE_LABEL[currentDesk]}. Delegate to another desk — the plan
                  rebuilds and still needs your sign-off.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {EXECUTIVES.filter((d) => d !== currentDesk).map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setOpen(false);
                        onDelegate(d);
                      }}
                      className="rounded-full border border-line/80 bg-surface-1/75 px-3 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary disabled:opacity-40"
                    >
                      {EXECUTIVE_LABEL[d]}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] text-fg-muted">
                Currently {EXECUTIVE_LABEL[currentDesk]}. Delegating to another desk re-plans the work,
                so it&apos;s available before approval.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
