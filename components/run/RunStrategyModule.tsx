import Link from "next/link";
import { getRunConviction, type DealConviction } from "@/lib/run-conviction";
import type { Mandate } from "@/lib/build-readiness";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import {
  computeAllocation,
  prioritize,
  type AllocationDimension,
  type PriorityDeal,
} from "@/lib/run-strategy";
import { StrategyFitControl } from "@/components/run/StrategyFitControl";

// Shared empty state for the derived Run modules — points back to the deal
// pipeline, the source of the working set these modules read from.
function NoActiveDeals({ note }: { note: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
      <span
        aria-hidden
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/5 font-mono text-sm text-gold-400"
      >
        ✶
      </span>
      <p className="max-w-sm text-sm text-fg-secondary">{note}</p>
      <Link
        href="/source/deal_pipeline"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
      >
        → Deal pipeline
      </Link>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{children}</span>
  );
}

function StageBadge({ d }: { d: DealConviction }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${d.stage.tone}`}
    >
      {d.stage.label}
    </span>
  );
}

// A thin conviction meter (0–100), tone shifting with the score.
function Meter({ value }: { value: number }) {
  const tone = value >= 85 ? "bg-emerald-400" : value >= 35 ? "bg-gold-400" : "bg-fg-muted";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(value, 3)}%` }} />
    </div>
  );
}

function fitChip(ok: boolean | null, label: string) {
  const tone =
    ok === null
      ? "border-line text-fg-muted"
      : ok
        ? "border-emerald-400/40 text-emerald-300"
        : "border-status-danger/40 text-status-danger";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {ok === null ? "○" : ok ? "✓" : "✗"} {label}
    </span>
  );
}

function inMandate(value: string | null, list: string[]): boolean | null {
  if (!value) return null;
  if (!list.length) return null;
  const v = value.toLowerCase();
  return list.some((x) => x.toLowerCase().includes(v) || v.includes(x.toLowerCase()));
}

// --- Allocation / mandate coverage ----------------------------------------
// A horizontal stacked bar of a dimension's slices plus the uncovered mandate
// buckets, so concentration and gaps read at a glance.
const SLICE_TONES = [
  "bg-gold-400",
  "bg-status-info",
  "bg-emerald-400",
  "bg-gold-500/70",
  "bg-fg-muted",
];

function AllocationBar({
  title,
  dim,
  total,
}: {
  title: string;
  dim: AllocationDimension;
  total: number;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        {dim.unspecified > 0 ? (
          <span className="font-mono text-[10px] text-fg-muted">{dim.unspecified} unset</span>
        ) : null}
      </div>
      <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-surface-0">
        {dim.slices.map((s, i) => (
          <div
            key={s.label}
            className={`h-full ${SLICE_TONES[i % SLICE_TONES.length]} ${
              s.concentrated ? "ring-1 ring-inset ring-status-warning/60" : ""
            }`}
            style={{ width: `${Math.max(s.share * 100, 2)}%` }}
            title={`${s.label}: ${s.count}/${total}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {dim.slices.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
            <span
              className={`h-2 w-2 rounded-sm ${SLICE_TONES[i % SLICE_TONES.length]}`}
              aria-hidden
            />
            <span className="capitalize">{s.label.replace(/_/g, " ")}</span>
            <span className="font-mono text-fg-muted">{Math.round(s.share * 100)}%</span>
            {s.concentrated ? (
              <span className="font-mono text-[9px] uppercase tracking-wider text-status-warning">
                concentrated
              </span>
            ) : null}
          </span>
        ))}
        {dim.slices.length === 0 ? <span className="text-[11px] text-fg-muted">—</span> : null}
      </div>
      {dim.gaps.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2.5">
          <Label>Mandate gaps</Label>
          {dim.gaps.map((g) => (
            <span
              key={g.label}
              className="rounded-full border border-status-danger/40 px-2 py-0.5 text-[11px] capitalize text-status-danger"
            >
              ✗ {g.label.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- Comparison table ------------------------------------------------------
function ComparisonTable({ deals, m }: { deals: DealConviction[]; m: Mandate | null }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface-1">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {["Deal", "Fit", "Conviction", "IRR vs target", "Open risks", "Stage"].map((h) => (
              <th
                key={h}
                className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const fitPct = d.deal.thesis_fit != null ? Math.round(d.deal.thesis_fit * 100) : null;
            const retOk =
              d.projectedIrr != null && m?.targetIrr != null ? d.projectedIrr >= m.targetIrr : null;
            return (
              <tr key={d.deal.id} className="border-b border-line/50 last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/deal/${d.deal.id}`}
                    className="font-medium text-fg-primary transition hover:text-gold-300"
                  >
                    {d.deal.name}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-fg-secondary">
                  {fitPct != null ? `${fitPct}%` : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-fg-secondary">{d.score}</td>
                <td className="px-3 py-2 font-mono">
                  {d.projectedIrr != null ? (
                    <span
                      className={
                        retOk === null
                          ? "text-fg-secondary"
                          : retOk
                            ? "text-emerald-300"
                            : "text-status-danger"
                      }
                    >
                      {d.projectedIrr}%
                      {m?.targetIrr != null ? (
                        <span className="text-fg-muted"> / {m.targetIrr}%</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">
                  {d.openRisks.length > 0 ? (
                    <span className="text-status-danger">{d.openRisks.length}</span>
                  ) : (
                    <span className="text-fg-muted">0</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StageBadge d={d} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Deal row --------------------------------------------------------------
function DealRow({
  d,
  m,
  rank,
}: {
  d: DealConviction;
  m: Mandate | null;
  rank: number;
}) {
  const acFit = inMandate(d.deal.asset_class, m?.assetClasses ?? []);
  const geoFit = inMandate(d.deal.geography, m?.geographies ?? []);
  const retFit =
    d.projectedIrr != null && m?.targetIrr != null ? d.projectedIrr >= m.targetIrr : null;
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/deal/${d.deal.id}`} className="min-w-0 flex items-center gap-2">
          <span className="font-mono text-[10px] text-fg-muted">#{rank}</span>
          <span className="truncate font-medium text-fg-primary transition hover:text-gold-300">
            {d.deal.name}
          </span>
        </Link>
        <StageBadge d={d} />
      </div>
      <div className="mt-2.5">
        <Meter value={d.score} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {fitChip(acFit, d.deal.asset_class ?? "asset class")}
        {fitChip(geoFit, d.deal.geography ?? "geography")}
        {fitChip(retFit, d.projectedIrr != null ? `${d.projectedIrr}% IRR` : "return")}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/60 pt-3">
        <Label>Thesis fit</Label>
        <StrategyFitControl dealId={d.deal.id} value={d.deal.thesis_fit} />
      </div>
    </div>
  );
}

// --- Strategy: thesis-fit board -------------------------------------------
// Frames every active deal against the mandate so evaluation stays anchored to
// strategy rather than drifting deal-by-deal: a prioritized focus signal, the
// allocation/coverage of the live pipeline against the mandate, a per-deal
// fit board, and a side-by-side comparison for allocation decisions.
export async function RunStrategyModule({ orgId }: { orgId: string }) {
  const { deals, mandate } = await getRunConviction(orgId);

  if (deals.length === 0) {
    return (
      <div>
        <ModuleHeader title="Strategy" blurb="Every live deal scored against your mandate." />
        <NoActiveDeals note="No deals in evaluation. Move a deal into diligence and it will be scored against your mandate here." />
      </div>
    );
  }

  const m: Mandate | null = mandate;
  const allocation = computeAllocation(deals, m);
  const ranked: PriorityDeal[] = prioritize(deals);
  const focus = ranked[0];

  return (
    <div className="flex flex-col gap-5">
      <ModuleHeader
        title="Strategy"
        blurb="Every live deal scored against your mandate — fit, return, and conviction at a glance."
      />

      {/* Focus next: the single highest-priority deal to push */}
      <div className="rounded-xl border border-gold-500/40 bg-gold-500/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <Label>Focus next</Label>
          <span className="font-mono text-[10px] text-gold-300">
            priority {focus.priority}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/deal/${focus.conviction.deal.id}`}
            className="font-display text-lg font-semibold text-fg-primary transition hover:text-gold-300"
          >
            {focus.conviction.deal.name}
          </Link>
          <StageBadge d={focus.conviction} />
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          {focus.conviction.score} conviction · {Math.round(focus.factors.fit * 100)}% thesis fit
          {focus.conviction.openRisks.length > 0
            ? ` · ${focus.conviction.openRisks.length} open risk${focus.conviction.openRisks.length > 1 ? "s" : ""}`
            : ""}{" "}
          — the strongest blend of conviction, fit, and size in the working set.
        </p>
      </div>

      {/* Mandate coverage / allocation */}
      <section>
        <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Allocation &amp; mandate coverage
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <AllocationBar title="By asset class" dim={allocation.byAssetClass} total={allocation.total} />
          <AllocationBar title="By geography" dim={allocation.byGeography} total={allocation.total} />
        </div>
      </section>

      {/* Prioritization queue / per-deal fit board */}
      <section>
        <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Prioritization queue
        </h3>
        <div className="flex flex-col gap-2.5">
          {ranked.map((p, i) => (
            <DealRow key={p.conviction.deal.id} d={p.conviction} m={m} rank={i + 1} />
          ))}
        </div>
      </section>

      {/* Side-by-side comparison */}
      <section>
        <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Deal comparison
        </h3>
        <ComparisonTable deals={deals} m={m} />
      </section>
    </div>
  );
}
