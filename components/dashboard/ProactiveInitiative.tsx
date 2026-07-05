"use client";

// components/dashboard/ProactiveInitiative.tsx
// The Report-dashboard surface for Earn's self-authored Commands. NOT a new
// floating widget — it renders inline on the Command Center, where outcomes
// already collapse. Each item arrives as a FINISHED decision: the pre-run draft
// is embedded, every intelligence claim shows its provenance (source · as-of ·
// confidence), and the blast-radius gate decides what the operator can do
// (approve/edit/send, or a signed sign-off for compliance-binding items).

import { useState } from "react";
import Link from "next/link";
import { TIER_LABEL, TIER_STYLE, type GateTier } from "@/lib/gates";
import type { ProactiveItem, ProvenancedClaim } from "@/lib/proactive/types";
import { approveProactive, dismissProactive, snoozeProactive } from "@/app/(app)/dashboard/proactive-actions";

export interface ProactiveItemView extends ProactiveItem {
  draft: string | null;
}

function ProvenanceChip({ claim }: { claim: ProvenancedClaim }) {
  const tone = claim.verified
    ? "border-emerald-500/40 text-emerald-300"
    : "border-gold-500/40 text-gold-300";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone}`}
      title={claim.claim}
    >
      <span aria-hidden>◆</span>
      {claim.source}
      {claim.verified ? "" : "·modeled"} · as of {claim.asOf.slice(0, 10)} · {Math.round(claim.confidence * 100)}%
    </span>
  );
}

function Card({ item }: { item: ProactiveItemView }) {
  const [open, setOpen] = useState(false);
  const tier = item.blastRadius as GateTier;
  const nonSkippable = tier === 3;
  const approveLabel = nonSkippable ? "Sign & approve" : "Approve & send";

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30">
      {/* Header row: hub, class, blast-radius tier, priority */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{item.hub}</span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            item.signalClass === "market"
              ? "border-cyan-500/40 text-cyan-300"
              : "border-line text-fg-muted"
          }`}
        >
          {item.signalClass === "market" ? "Market-aware" : "Internal"}
        </span>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[tier]}`}>
          {TIER_LABEL[tier]}
        </span>
        <span className="ml-auto font-mono text-[10px] text-fg-muted">P{item.priority}</span>
      </div>

      {/* Title + why-now rationale */}
      <div>
        <p className="text-sm font-medium text-fg-primary">{item.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{item.rationale}</p>
      </div>

      {/* Provenance — every intelligence-derived claim carries its source */}
      {item.claims.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.claims.map((c, i) => (
            <ProvenanceChip key={i} claim={c} />
          ))}
        </div>
      )}

      {/* Inline pre-run draft — the finished work product, ready to review */}
      {item.draft && (
        <div className="rounded-lg border border-line bg-surface-2/50">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
          >
            <span>Drafted deliverable</span>
            <span aria-hidden>{open ? "−" : "+"}</span>
          </button>
          {open && (
            <p className="whitespace-pre-wrap border-t border-line px-3 py-2 text-xs leading-relaxed text-fg-secondary">
              {item.draft}
            </p>
          )}
        </div>
      )}

      {nonSkippable && (
        <p className="rounded-md border border-status-danger/40 bg-status-danger/5 px-2.5 py-1.5 text-[11px] text-status-danger">
          Compliance-binding — a signed, logged sign-off is required. This cannot be auto-sent.
        </p>
      )}

      {/* Gate-aware actions — approve/edit/send, dismiss, snooze */}
      <div className="flex items-center gap-2 pt-0.5">
        <form action={approveProactive}>
          <input type="hidden" name="itemId" value={item.id} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:border-gold-500/70 hover:bg-gold-500/20"
          >
            <span aria-hidden>✓</span>
            {approveLabel}
          </button>
        </form>
        {item.workflowId && (
          <Link
            href={`/report?task_id=${item.workflowId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
          >
            Edit
          </Link>
        )}
        <form action={snoozeProactive} className="ml-auto">
          <input type="hidden" name="itemId" value={item.id} />
          <button type="submit" className="font-mono text-[10px] text-fg-muted transition hover:text-fg-secondary">
            Snooze
          </button>
        </form>
        <form action={dismissProactive}>
          <input type="hidden" name="itemId" value={item.id} />
          <button type="submit" className="font-mono text-[10px] text-fg-muted transition hover:text-fg-secondary">
            Dismiss
          </button>
        </form>
      </div>
    </div>
  );
}

export function ProactiveInitiative({ items }: { items: ProactiveItemView[] }) {
  if (items.length === 0) return null; // silent when Earn has nothing to propose

  return (
    <section aria-label="Earn initiative" className="mb-6">
      <header className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_2px_rgba(99,102,241,0.4)]" aria-hidden />
          Earn Initiative
        </span>
        {/* Earn-level count — how many finished decisions await the operator */}
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-200">
          {items.length} awaiting you
        </span>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <Card key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
