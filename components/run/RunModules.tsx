import Link from "next/link";
import { getRunConviction, toPercent, effectiveSeverity, type DealConviction } from "@/lib/run-conviction";
import type { Mandate } from "@/lib/build-readiness";
import type { DiligenceItem } from "@/lib/supabase/database.types";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { draftDealComms } from "@/app/(app)/[hub]/[module]/actions";

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
                {fitChip(
                  retFit,
                  d.projectedIrr != null ? `${d.projectedIrr}% IRR` : "return",
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// --- Risk: cross-deal risk register ---------------------------------------
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_TONE: Record<string, string> = {
  critical: "border-status-danger/50 bg-status-danger/10 text-status-danger",
  high: "border-status-danger/40 text-status-danger",
  medium: "border-gold-500/40 text-gold-300",
  low: "border-line text-fg-muted",
};
const RESOLVED = new Set(["cleared", "waived"]);

function SeverityPill({ sev }: { sev: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
        SEVERITY_TONE[sev] ?? "border-line text-fg-muted"
      }`}
    >
      {sev}
    </span>
  );
}

export async function RunRiskModule({ orgId }: { orgId: string }) {
  const { deals } = await getRunConviction(orgId);
  const nameById = new Map(deals.map((d) => [d.deal.id, d.deal.name]));

  // Flatten flagged / severity-scored diligence findings across the working set
  // into one register, unresolved-and-severe first. Severity is the residual
  // (post-mitigation) severity, so a mitigated finding drops down the register.
  const register: DiligenceItem[] = deals
    .flatMap((d) => d.diligence)
    .filter((i) => i.risk_severity != null || i.status === "flagged");
  register.sort((a, b) => {
    const aOpen = !RESOLVED.has(a.status) ? 0 : 1;
    const bOpen = !RESOLVED.has(b.status) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (
      (SEVERITY_RANK[effectiveSeverity(a) ?? "low"] ?? 9) -
      (SEVERITY_RANK[effectiveSeverity(b) ?? "low"] ?? 9)
    );
  });

  const counts = register.reduce<Record<string, number>>((acc, i) => {
    const sev = effectiveSeverity(i);
    if (!RESOLVED.has(i.status) && sev) acc[sev] = (acc[sev] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <ModuleHeader
        title="Risk"
        blurb="Open findings across every live deal, ranked by severity — your standing risk register."
      />
      {register.length === 0 ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 px-6 py-8 text-center text-sm text-emerald-300">
          ✓ No risk findings flagged across the active pipeline.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {(["critical", "high", "medium", "low"] as const).map((s) => (
              <span
                key={s}
                className={`rounded-full border px-2.5 py-1 text-xs ${SEVERITY_TONE[s]} ${
                  counts[s] ? "" : "opacity-40"
                }`}
              >
                <span className="font-mono">{counts[s] ?? 0}</span> {s} open
              </span>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            {register.map((i, idx) => {
              const resolved = RESOLVED.has(i.status);
              const mitigated = !!i.mitigation && i.residual_severity != null;
              return (
                <Link
                  href={`/deal/${i.deal_id}`}
                  key={i.id}
                  className={`flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2 ${
                    idx > 0 ? "border-t border-line/50" : ""
                  } ${resolved ? "opacity-50" : "bg-surface-1"}`}
                >
                  <SeverityPill sev={effectiveSeverity(i) ?? "low"} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${resolved ? "text-fg-muted line-through" : "text-fg-primary"}`}>
                      {i.title}
                      {mitigated ? (
                        <span className="ml-2 rounded-full border border-status-info/40 px-1.5 py-0.5 align-middle font-mono text-[9px] uppercase tracking-wider text-status-info">
                          mitigated
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {nameById.get(i.deal_id) ?? "—"} · {i.category} · {i.status.replace("_", " ")}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// --- Stress Test: downside vs base ----------------------------------------
export async function RunStressTestModule({ orgId }: { orgId: string }) {
  const { deals } = await getRunConviction(orgId);

  if (deals.length === 0) {
    return (
      <div>
        <ModuleHeader title="Stress Test" blurb="Downside and stress cases against each base underwriting." />
        <NoActiveDeals note="No deals in evaluation. Underwrite a deal and stress its downside here." />
      </div>
    );
  }

  const STRESS = new Set(["downside", "stress", "bear", "bear_case"]);
  return (
    <div>
      <ModuleHeader
        title="Stress Test"
        blurb="How each deal holds up below base case — the downside is where conviction is earned."
      />
      <div className="flex flex-col gap-2.5">
        {deals.map((d) => {
          const base = d.baseCase;
          const stresses = d.cases.filter((u) => STRESS.has(u.scenario));
          const baseIrr = toPercent(base?.projected_irr ?? null);
          return (
            <div key={d.deal.id} className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium text-fg-primary">{d.deal.name}</span>
                <span className="font-mono text-[11px] text-fg-muted">
                  base {baseIrr != null ? `${baseIrr}% IRR` : "—"}
                </span>
              </div>
              {stresses.length === 0 ? (
                <p className="mt-2 text-xs text-status-warning">
                  No downside case — conviction is unproven until you stress it.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {stresses.map((s) => {
                    const sIrr = toPercent(s.projected_irr);
                    const delta = sIrr != null && baseIrr != null ? sIrr - baseIrr : null;
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="capitalize text-fg-secondary">{s.scenario.replace("_", " ")}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-fg-primary">
                            {sIrr != null ? `${sIrr}% IRR` : "—"}
                          </span>
                          {delta != null ? (
                            <span
                              className={`font-mono text-[11px] ${
                                delta >= 0 ? "text-emerald-300" : "text-status-danger"
                              }`}
                            >
                              {delta >= 0 ? "+" : ""}
                              {delta.toFixed(1)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Comms: deal-aware Earn launchpad -------------------------------------
function CommsButton({ dealId, kind, label }: { dealId: string; kind: string; label: string }) {
  return (
    <form action={draftDealComms}>
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="kind" value={kind} />
      <button className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20">
        ✶ {label}
      </button>
    </form>
  );
}

export async function RunCommsModule({ orgId }: { orgId: string }) {
  const { deals } = await getRunConviction(orgId);

  if (deals.length === 0) {
    return (
      <div>
        <ModuleHeader title="Comms" blurb="Draft deal communications grounded in the live evaluation." />
        <NoActiveDeals note="No deals in evaluation. Once a deal is in flight, draft its IC memo and LP updates here." />
      </div>
    );
  }

  return (
    <div>
      <ModuleHeader
        title="Comms"
        blurb="Turn the evaluation into the memo. Earn drafts each artifact from this deal's live diligence and underwriting."
      />
      <div className="flex flex-col gap-2.5">
        {deals.map((d) => (
          <div
            key={d.deal.id}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2.5">
              <StageBadge d={d} />
              <span className="truncate font-medium text-fg-primary">{d.deal.name}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <CommsButton dealId={d.deal.id} kind="screening_memo" label="Screening memo" />
              <CommsButton dealId={d.deal.id} kind="ic_memo" label="IC memo" />
              <CommsButton dealId={d.deal.id} kind="lp_update" label="LP update" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
