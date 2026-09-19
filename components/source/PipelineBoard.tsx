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
  adjustPipelineSummary,
  impliedStatus,
  type OpportunityStage,
  type StageSummary,
  type SummaryDelta,
} from "@/lib/network-opportunities";

export type { StageSummary } from "@/lib/network-opportunities";

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
  // `expectedClose` is a DATE, so it parses to midnight UTC. Formatted in the
  // browser zone, a deal closing 2026-09-26 printed "Sep 25" on its card while
  // the calendar drew it in the Sep 26 cell — one deal, two dates, depending
  // on which tab you were looking at.
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
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
  // Cards moved in this session, keyed by deal id so a card moved twice holds
  // one delta rather than accumulating them.
  const [moves, setMoves] = useState<Map<string, SummaryDelta>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const liveRegion = useRef<HTMLParagraphElement | null>(null);

  // Re-seed when the server sends a different page.
  //
  // `useState(initialOpportunities)` runs its initializer ONCE. A
  // `router.refresh()` re-renders the server component and hands down a new
  // array, but React keeps this component mounted and `deals` keeps pointing at
  // the page from first paint — so a deal created through the new-allocation
  // form never appeared on the board until a full reload. The board could
  // create work it then refused to show.
  //
  // Adjusting state during render rather than in an effect is deliberate: React
  // re-runs this component immediately with the corrected state and never
  // paints the stale board, where an effect would show the old page for a frame
  // first.
  const [seed, setSeed] = useState(initialOpportunities);
  // Advances on every re-seed. A drag started against one server snapshot must
  // not write into a newer one: clearing `moves` below only discards the deltas
  // that exist AT that moment, and a PATCH still in flight would re-add its
  // delta afterwards — on top of a rollup that already counts the committed
  // move. That is the same double-count the clear was meant to prevent, just
  // arriving a few hundred milliseconds later.
  const seedEpoch = useRef(0);
  if (seed !== initialOpportunities) {
    setSeed(initialOpportunities);
    setDeals(initialOpportunities);
    // The deltas existed only to correct a rollup computed BEFORE those moves.
    // This rollup was computed after them, so keeping the deltas would count
    // every move a second time.
    setMoves(new Map());
    seedEpoch.current += 1;
  }

  const byStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const stage of BOARD_STAGES) map.set(stage, []);
    for (const d of deals) map.get(d.stage)?.push(d);
    return map;
  }, [deals]);

  // The header comes from the SERVER's rollup, corrected for moves made since
  // it was computed — not from the cards on screen. The board loads a capped
  // page, so deriving totals from `deals` made an organization past that cap
  // under-report its own pipeline: the number on screen was the sample, not
  // the business.
  const adjusted = useMemo(
    () => adjustPipelineSummary(initialSummary, moves.values()),
    [initialSummary, moves],
  );

  /** Per stage, the rows for each currency present. Currencies stay apart. */
  const summary = useMemo(() => {
    const map = new Map<OpportunityStage, StageSummary[]>();
    for (const stage of BOARD_STAGES) map.set(stage, []);
    for (const row of adjusted) map.get(row.stage)?.push(row);
    for (const rows of map.values()) rows.sort((a, b) => b.targetTotal - a.targetTotal);
    return map;
  }, [adjusted]);

  /** Top line: open work only, still never summing across currencies. */
  const totals = useMemo(() => {
    const open = adjusted.filter((r) => impliedStatus(r.stage) === "open");
    const byCurrency = new Map<string, { target: number; weighted: number }>();
    let count = 0;
    for (const r of open) {
      count += r.dealCount;
      const c = byCurrency.get(r.currency) ?? { target: 0, weighted: 0 };
      c.target += r.targetTotal;
      c.weighted += r.weightedTotal;
      byCurrency.set(r.currency, c);
    }
    return {
      count,
      byCurrency: [...byCurrency.entries()]
        .map(([currency, v]) => ({ currency, ...v }))
        .sort((a, b) => b.target - a.target),
    };
  }, [adjusted]);

  const moveDeal = useCallback(
    async (dealId: string, stage: OpportunityStage) => {
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage === stage) return;
      // Cards move independently (busy state is per deal), so a failure must
      // restore only this card rather than the whole board snapshot.
      const previousStage = deal.stage;

      // What the card contributed to the rollup before this move. Kept from the
      // card's ORIGINAL stage across repeated moves, so the delta stays
      // relative to the server's numbers rather than to the last drag.
      const origin = moves.get(dealId);
      const fromStage = origin?.fromStage ?? previousStage;
      const before = origin?.before ?? {
        targetAmount: deal.targetAmount,
        probability: deal.probability,
      };

      const epochAtStart = seedEpoch.current;

      setBusy((b) => new Set(b).add(dealId));
      // Optimistic: the card lands where it was dropped immediately, and the
      // header moves with it rather than waiting for the server's rollup.
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)));
      setMoves((m) => {
        const next = new Map(m);
        next.set(dealId, {
          id: dealId,
          fromStage,
          toStage: stage,
          currency: deal.currency,
          before,
          after: { targetAmount: deal.targetAmount, probability: deal.probability },
        });
        return next;
      });
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
        if (seedEpoch.current !== epochAtStart) {
          // The server re-rendered while this was in flight. Its page and its
          // rollup already include this move, so both the card and the delta
          // below would be applied twice. Leave the fresh snapshot alone.
          setError(null);
          return;
        }
        // Take the server's version: it decided status, close date and
        // probability, and those are not guessable from the drop alone.
        setDeals((prev) => prev.map((d) => (d.id === dealId ? body.opportunity! : d)));
        // Reconcile the delta with what the server actually stored: the PATCH
        // decides status and probability, so the optimistic guess above can be
        // wrong about the weighted figure.
        const saved = body.opportunity;
        setMoves((m) => {
          const next = new Map(m);
          next.set(dealId, {
            id: dealId,
            fromStage,
            toStage: saved.stage,
            currency: saved.currency,
            before,
            after: { targetAmount: saved.targetAmount, probability: saved.probability },
          });
          return next;
        });
        setError(null);
      } catch (err) {
        if (seedEpoch.current !== epochAtStart) {
          // A newer snapshot already shows the deal where the server has it —
          // un-moved, since the PATCH failed. Rolling back would restore a
          // delta measured against a rollup that no longer exists.
          return;
        }
        setDeals((current) =>
          current.map((d) => (d.id === dealId ? { ...d, stage: previousStage } : d)),
        );
        // Drop the delta too, or the header keeps counting a move that did not
        // happen. Restoring the prior delta rather than deleting outright keeps
        // an earlier successful move intact.
        setMoves((m) => {
          const next = new Map(m);
          if (origin) next.set(dealId, origin);
          else next.delete(dealId);
          return next;
        });
        setError(err instanceof Error ? err.message : "Couldn't move that deal.");
      } finally {
        setBusy((b) => {
          const next = new Set(b);
          next.delete(dealId);
          return next;
        });
      }
    },
    [deals, moves],
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
        {/* One pair per currency. Adding a EUR total to a USD total produces a
            number that is not money in either, so they are never combined. */}
        {totals.byCurrency.map(({ currency, target, weighted }) => (
          <span key={currency} className="flex items-baseline gap-x-4">
            <span className="text-xs text-fg-muted">
              Pipeline{" "}
              <span className="font-mono tabular-nums text-fg-secondary">
                {compactUsd(target, currency)}
              </span>
            </span>
            <span
              className="text-xs text-fg-muted"
              title="Target size discounted by each deal's probability"
            >
              Weighted{" "}
              <span className="font-mono tabular-nums text-gold-300">
                {compactUsd(weighted, currency)}
              </span>
            </span>
          </span>
        ))}
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
          const stats = summary.get(stage) ?? [];
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
                    {stats.reduce((n, r) => n + r.dealCount, 0)}
                  </span>
                </div>
                {stats.length === 0 ? (
                  <p className="mt-0.5 text-[11px] tabular-nums text-fg-muted">
                    {compactUsd(0)}
                  </p>
                ) : (
                  stats.map((r) => (
                    <p
                      key={r.currency}
                      className="mt-0.5 flex items-baseline gap-2 text-[11px] text-fg-muted"
                    >
                      <span className="tabular-nums">
                        {compactUsd(r.targetTotal, r.currency)}
                      </span>
                      {r.weightedTotal > 0 && (
                        <span className="tabular-nums text-gold-300/80">
                          {compactUsd(r.weightedTotal, r.currency)} wtd
                        </span>
                      )}
                    </p>
                  ))
                )}
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
