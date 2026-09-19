"use client";

// The pipeline board — allocations grouped by stage.
//
// Drag a card to move a deal. The write goes through PATCH
// /api/network/opportunities/[id], which decides what the move implies
// (closing, the close stamp, the probability floor/ceiling) and writes the
// change onto the contact's timeline. The card moves optimistically and snaps
// back if the write fails, because a board that lies about where a deal sits is
// worse than one that is briefly slow.
//
// Column headers show count, total and WEIGHTED total. The weighted number is
// the one worth reading: $40m of pipeline at 10% is not $40m.

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  OPPORTUNITY_STAGES,
  STAGE_LABEL,
  weightedAmount,
  type Opportunity,
  type OpportunityStage,
} from "@/lib/network-opportunities";

export interface StageSummary {
  stage: OpportunityStage;
  dealCount: number;
  targetTotal: number;
  weightedTotal: number;
}

/** Board columns. Closed stages live at the end, visually separated. */
const BOARD_STAGES: OpportunityStage[] = [...OPPORTUNITY_STAGES];

const STAGE_TONE: Record<OpportunityStage, string> = {
  sourced: "border-line",
  qualified: "border-fg-muted/40",
  diligence: "border-gold-500/40",
  ic_review: "border-accent-400/40",
  legal: "border-accent-400/60",
  committed: "border-emerald-500/50",
  passed: "border-rose-500/30",
};

function compactUsd(n: number, currency = "USD"): string {
  if (!n) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const prefix = currency === "USD" ? "$" : `${currency} `;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${prefix}${Math.round(abs / 1e3)}K`;
  return `${sign}${prefix}${Math.round(abs)}`;
}

function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  initialOpportunities: Opportunity[];
  initialSummary: StageSummary[];
  owners?: { id: string; name: string }[];
  onOpenContact?: (contactId: string) => void;
}

export function PipelineBoard({ initialOpportunities, initialSummary }: Props) {
  const [deals, setDeals] = useState<Opportunity[]>(initialOpportunities);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<OpportunityStage | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const liveRegion = useRef<HTMLParagraphElement | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const stage of BOARD_STAGES) map.set(stage, []);
    for (const d of deals) map.get(d.stage)?.push(d);
    return map;
  }, [deals]);

  // Recomputed from the cards on screen so the header stays in step with an
  // optimistic move instead of waiting for the server's rollup.
  const summary = useMemo(() => {
    const map = new Map<OpportunityStage, StageSummary>();
    for (const stage of BOARD_STAGES) {
      const rows = byStage.get(stage) ?? [];
      const open = rows.filter((d) => d.status === "open");
      map.set(stage, {
        stage,
        dealCount: rows.length,
        targetTotal: open.reduce((sum, d) => sum + (d.targetAmount ?? 0), 0),
        weightedTotal: open.reduce(
          (sum, d) => sum + weightedAmount(d.targetAmount, d.probability),
          0,
        ),
      });
    }
    return map;
  }, [byStage]);

  const totals = useMemo(() => {
    const open = deals.filter((d) => d.status === "open");
    return {
      count: open.length,
      target: open.reduce((s, d) => s + (d.targetAmount ?? 0), 0),
      weighted: open.reduce((s, d) => s + weightedAmount(d.targetAmount, d.probability), 0),
    };
  }, [deals]);

  const moveDeal = useCallback(
    async (dealId: string, stage: OpportunityStage) => {
      const before = deals;
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage === stage) return;

      setBusy((b) => new Set(b).add(dealId));
      // Optimistic: the card lands where it was dropped immediately.
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)));
      if (liveRegion.current) {
        liveRegion.current.textContent = `${deal.name} moved to ${STAGE_LABEL[stage]}`;
      }

      try {
        const res = await fetch(`/api/network/opportunities/${dealId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        const body = (await res.json().catch(() => null)) as
          | { opportunity?: Opportunity; error?: string }
          | null;
        if (!res.ok || !body?.opportunity) throw new Error(body?.error ?? "Move failed");
        // Take the server's version: it decided status, close date and
        // probability, and those are not guessable from the drop alone.
        setDeals((prev) => prev.map((d) => (d.id === dealId ? body.opportunity! : d)));
        setError(null);
      } catch (err) {
        setDeals(before);
        setError(err instanceof Error ? err.message : "Couldn't move that deal.");
      } finally {
        setBusy((b) => {
          const next = new Set(b);
          next.delete(dealId);
          return next;
        });
      }
    },
    [deals],
  );

  if (deals.length === 0) {
    return (
      <div className="fx-card p-8 text-center">
        <p className="text-sm font-medium text-fg-primary">No live allocations</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
          A deal is an allocation being worked toward a vehicle — a target size, odds, and an
          expected close. Open one from a contact&apos;s record to start tracking it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Pipeline totals */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-sm text-fg-secondary">
          <span className="font-display text-lg font-semibold tabular-nums text-fg-primary">
            {totals.count}
          </span>{" "}
          open {totals.count === 1 ? "allocation" : "allocations"}
        </p>
        <p className="text-xs text-fg-muted">
          Pipeline{" "}
          <span className="font-mono tabular-nums text-fg-secondary">
            {compactUsd(totals.target)}
          </span>
        </p>
        <p className="text-xs text-fg-muted" title="Target size discounted by each deal's probability">
          Weighted{" "}
          <span className="font-mono tabular-nums text-gold-300">
            {compactUsd(totals.weighted)}
          </span>
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-fg-muted hover:text-fg-primary">
            ×
          </button>
        </div>
      )}

      <p ref={liveRegion} aria-live="polite" className="sr-only" />

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {BOARD_STAGES.map((stage) => {
          const rows = byStage.get(stage) ?? [];
          const stats = summary.get(stage);
          return (
            <section
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                const id = e.dataTransfer.getData("text/plain") || dragging;
                if (id) void moveDeal(id, stage);
                setDragging(null);
              }}
              className={`flex w-64 shrink-0 flex-col rounded-xl border bg-surface-1/40 transition ${
                overStage === stage ? "border-gold-400 bg-gold-500/5" : STAGE_TONE[stage]
              }`}
            >
              <header className="border-b border-line/60 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-mono text-[11px] uppercase tracking-wider text-fg-secondary">
                    {STAGE_LABEL[stage]}
                  </h3>
                  <span className="font-mono text-[11px] tabular-nums text-fg-muted">
                    {stats?.dealCount ?? 0}
                  </span>
                </div>
                <p className="mt-0.5 flex items-baseline gap-2 text-[11px] text-fg-muted">
                  <span className="tabular-nums">{compactUsd(stats?.targetTotal ?? 0)}</span>
                  {(stats?.weightedTotal ?? 0) > 0 && (
                    <span className="tabular-nums text-gold-300/80">
                      {compactUsd(stats?.weightedTotal ?? 0)} wtd
                    </span>
                  )}
                </p>
              </header>

              <div className="flex min-h-[4rem] flex-col gap-2 p-2">
                {rows.length === 0 && (
                  <p className="px-1 py-3 text-center text-[11px] text-fg-muted/60">Drop here</p>
                )}
                {rows.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    busy={busy.has(deal.id)}
                    onDragStart={() => setDragging(deal.id)}
                    onDragEnd={() => setDragging(null)}
                    onMove={(next) => void moveDeal(deal.id, next)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({
  deal,
  busy,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  deal: Opportunity;
  busy: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stage: OpportunityStage) => void;
}) {
  const close = formatDay(deal.expectedClose);

  return (
    <article
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-lg border border-line bg-surface-1 p-2.5 transition ${
        busy ? "opacity-50" : "cursor-grab hover:border-fg-muted/50 active:cursor-grabbing"
      }`}
    >
      <p className="truncate text-xs font-medium text-fg-primary">{deal.name}</p>

      {deal.contactId ? (
        <Link
          href={`/network/${deal.contactId}`}
          className="mt-0.5 block truncate text-[11px] text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
        >
          {deal.contactName ?? "View contact"}
        </Link>
      ) : (
        deal.contactName && (
          <p className="mt-0.5 truncate text-[11px] text-fg-muted">{deal.contactName}</p>
        )
      )}

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-fg-secondary">
          {compactUsd(deal.targetAmount ?? 0, deal.currency)}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">
          {deal.probability}%
        </span>
      </div>

      {/* Probability bar — the weighted value made visible. */}
      <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${deal.status === "lost" ? "bg-rose-400/60" : "bg-gold-400"}`}
          style={{ width: `${Math.max(2, deal.probability)}%` }}
        />
      </div>

      {(close || deal.ownerName) && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-muted/80">
          {close && (
            <span className={deal.overdue ? "text-rose-300" : undefined}>
              {deal.overdue ? "overdue " : ""}
              {close}
            </span>
          )}
          {close && deal.ownerName && <span aria-hidden>·</span>}
          {deal.ownerName && <span className="truncate">{deal.ownerName}</span>}
        </p>
      )}

      {/* Keyboard and touch path — dragging is not reachable for everyone. */}
      <label className="mt-1.5 block">
        <span className="sr-only">Move {deal.name} to another stage</span>
        <select
          value={deal.stage}
          disabled={busy}
          onChange={(e) => onMove(e.target.value as OpportunityStage)}
          className="fx-focus w-full rounded border border-line bg-surface-2 px-1 py-0.5 text-[11px] text-fg-muted opacity-0 transition focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          {OPPORTUNITY_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
