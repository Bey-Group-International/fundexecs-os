import Link from "next/link";
import { getRunConviction, type DealConviction } from "@/lib/run-conviction";
import type { Mandate } from "@/lib/build-readiness";
import { ModuleHeader } from "@/components/build/DraftWithEarn";

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

// --- Strategy: thesis-fit board -------------------------------------------
// Frames every active deal against the mandate so evaluation stays anchored to
// strategy rather than drifting deal-by-deal.
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
  return (
    <div>
      <ModuleHeader
        title="Strategy"
        blurb="Every live deal scored against your mandate — fit, return, and conviction at a glance."
      />
      <div className="flex flex-col gap-2.5">
        {deals.map((d) => {
          const acFit = inMandate(d.deal.asset_class, m?.assetClasses ?? []);
          const geoFit = inMandate(d.deal.geography, m?.geographies ?? []);
          const retFit =
            d.projectedIrr != null && m?.targetIrr != null ? d.projectedIrr >= m.targetIrr : null;
          const thesisFitPct = d.deal.thesis_fit != null ? Math.round(d.deal.thesis_fit * 100) : null;
          return (
            <Link
              key={d.deal.id}
              href={`/deal/${d.deal.id}`}
              className="block rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium text-fg-primary">{d.deal.name}</span>
                <div className="flex items-center gap-2">
                  {thesisFitPct != null ? (
                    <span className="font-mono text-[11px] text-fg-muted">{thesisFitPct}% fit</span>
                  ) : null}
                  <StageBadge d={d} />
                </div>
              </div>
              <div className="mt-2.5">
                <Meter value={d.score} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {fitChip(acFit, d.deal.asset_class ?? "asset class")}
                {fitChip(geoFit, d.deal.geography ?? "geography")}
                {fitChip(retFit, d.projectedIrr != null ? `${d.projectedIrr}% IRR` : "return")}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
