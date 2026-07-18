"use client";

import Link from "next/link";
import type { LeafPane, PaneType } from "@/lib/terminal/layout";

// One visible pane. This is the Release-1 shell: each pane renders its binding +
// a deep link into the corresponding full FundExecs surface, plus (for gated
// commands) the plan preview and approval notice. The rich in-pane adapters (live
// war room, capital map, portfolio cockpit, Copilot thread) are layered on in
// later increments — so panes here never invent data, they orient and hand off.

// Only routes that exist today get a deep link; the rest stay self-contained.
const DEEP_LINK: Partial<Record<PaneType, string>> = {
  deal: "/deals",
  fund: "/portfolio",
  lp: "/investor",
  gp: "/portfolio",
  company: "/network",
  person: "/network",
  portfolio: "/portfolio",
  pipeline: "/deals",
  watchlist: "/signals",
  alerts: "/signals",
  document: "/document",
  dataroom: "/dataroom",
  relationship: "/relationship",
  copilot: "/earn",
};

const TYPE_BADGE: Record<PaneType, string> = {
  deal: "DEAL",
  fund: "FUND",
  lp: "LP",
  gp: "GP",
  company: "CO",
  person: "PERSON",
  portfolio: "PORT",
  pipeline: "PIPE",
  watchlist: "WATCH",
  alerts: "ALERTS",
  document: "DOC",
  dataroom: "ROOM",
  relationship: "REL",
  analysis: "ANALYSIS",
  copilot: "EARN",
  blank: "PANE",
};

export function PaneView({
  pane,
  focused,
  onFocus,
  onClose,
  onSplitRight,
  onSplitDown,
}: {
  pane: LeafPane;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
}) {
  const deepLink = DEEP_LINK[pane.paneType] ?? null;

  return (
    <section
      onMouseDown={onFocus}
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-surface-1 transition-colors ${
        focused ? "border-gold-400/60" : "border-line/70"
      }`}
      aria-label={pane.title}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line/60 bg-surface-0/60 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded border border-line/70 bg-surface-0/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-400">
            {TYPE_BADGE[pane.paneType]}
          </span>
          <span className="truncate text-xs font-medium text-fg-primary">{pane.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSplitRight}
            title="Split right"
            aria-label="Split right"
            className="rounded px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"
          >
            ⊟
          </button>
          <button
            type="button"
            onClick={onSplitDown}
            title="Split down"
            aria-label="Split down"
            className="rounded px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"
          >
            ⊞
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close pane"
            aria-label="Close pane"
            className="rounded px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface-2 hover:text-status-danger"
          >
            ✕
          </button>
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm text-fg-secondary">
        <PaneBody pane={pane} deepLink={deepLink} />
      </div>
    </section>
  );
}

function PaneBody({ pane, deepLink }: { pane: LeafPane; deepLink: string | null }) {
  if (pane.paneType === "blank") {
    return (
      <p className="text-fg-muted">
        Empty pane. Type a command in the bar above — e.g.{" "}
        <code className="font-mono text-fg-secondary">DEAL Maple Street</code> — to bind it.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pane.entityLabel ? (
        <p>
          <span className="text-fg-muted">Bound to </span>
          <span className="font-medium text-fg-primary">{pane.entityLabel}</span>.
        </p>
      ) : (
        <p className="text-fg-muted">No entity bound yet.</p>
      )}

      {pane.command ? (
        <p className="font-mono text-[11px] text-fg-muted">↳ {pane.command}</p>
      ) : null}

      {pane.paneType === "analysis" ? (
        <p className="rounded-md border border-line/60 bg-surface-0/50 px-3 py-2 text-xs text-fg-muted">
          Analysis workspace. The live model output (values, provenance, scenarios)
          wires in from the engine in a later release — this pane never shows
          invented figures.
        </p>
      ) : null}

      {deepLink ? (
        <Link
          href={deepLink}
          className="inline-flex items-center gap-1 text-xs font-medium text-gold-400 hover:text-gold-300"
        >
          Open full view →
        </Link>
      ) : null}
    </div>
  );
}
