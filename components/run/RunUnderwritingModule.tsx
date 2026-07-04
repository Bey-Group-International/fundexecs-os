import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { toPercent } from "@/lib/run-conviction";
import { addUnderwriting } from "@/app/(app)/deal/[id]/actions";
import {
  setUnderwritingProbability,
  setUnderwritingEquity,
} from "@/components/run/underwriting-actions";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";
import { ActionForm } from "@/components/shared/ActionForm";
import {
  compareScenarios,
  weightedReturn,
  rollupEquityRequired,
  readProbability,
  readAssumptions,
  groupByDeal,
  SCENARIO_ORDER,
  type WeightedCase,
} from "@/lib/underwriting-calc";
import { UnderwritingCalculator } from "@/components/run/UnderwritingCalculator";
import type { Deal, Underwriting } from "@/lib/supabase/database.types";

// Deals you can still underwrite — everything that hasn't been passed on or
// died. Ordered newest-first for the picker.
async function activeDeals(orgId: string): Promise<Deal[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("deals")
    .select("*")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .not("stage", "in", "(passed,dead)")
    .order("created_at", { ascending: false });
  return (data ?? []) as Deal[];
}

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

function DealPicker({ deals }: { deals: Deal[] }) {
  return (
    <select name="deal_id" className={fieldClass} required defaultValue="" aria-label="Deal">
      <option value="" disabled>
        Deal…
      </option>
      {deals.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

// Shared empty state when there's no deal to attach work to yet.
function NoDeals({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
      <p className="max-w-sm text-sm text-fg-secondary">
        No deals to {what} yet. Move a deal into evaluation from the{" "}
        <Link href="/source/deal_pipeline" className="text-gold-400 hover:underline">
          deal pipeline
        </Link>{" "}
        first.
      </p>
    </div>
  );
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

function deltaTone(d: number): string {
  if (d > 0) return "text-emerald-300";
  if (d < 0) return "text-status-danger";
  return "text-fg-muted";
}

function signed(n: number, suffix: string): string {
  const s = n > 0 ? "+" : "";
  return `${s}${n}${suffix}`;
}

// --- Scenario comparison table for one deal --------------------------------
function ScenarioComparison({ dealId, cases }: { dealId: string; cases: Underwriting[] }) {
  const { rows } = compareScenarios(dealId, cases);
  const present = rows.filter((r) => r.uw);
  if (present.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className={`${labelClass} py-1.5 pr-3 font-normal`}>Scenario</th>
            <th className={`${labelClass} py-1.5 pr-3 font-normal`}>IRR</th>
            <th className={`${labelClass} py-1.5 pr-3 font-normal`}>Δ IRR</th>
            <th className={`${labelClass} py-1.5 pr-3 font-normal`}>MOIC</th>
            <th className={`${labelClass} py-1.5 pr-3 font-normal`}>Δ MOIC</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.scenario} className={`border-b border-line/40 ${r.uw ? "" : "opacity-40"}`}>
              <td className="py-1.5 pr-3">
                <span className="uppercase tracking-wider text-gold-400">{r.scenario}</span>
              </td>
              <td className="py-1.5 pr-3 text-fg-primary">{r.irrPct != null ? `${r.irrPct}%` : "—"}</td>
              <td className={`py-1.5 pr-3 ${r.irrDeltaPct != null ? deltaTone(r.irrDeltaPct) : "text-fg-muted"}`}>
                {r.irrDeltaPct != null ? signed(r.irrDeltaPct, "pp") : "—"}
              </td>
              <td className="py-1.5 pr-3 text-fg-primary">{r.moic != null ? `${r.moic}x` : "—"}</td>
              <td className={`py-1.5 pr-3 ${r.moicDelta != null ? deltaTone(r.moicDelta) : "text-fg-muted"}`}>
                {r.moicDelta != null ? signed(r.moicDelta, "x") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Per-case controls: probability, equity, and the inputs calculator -----
function CaseControls({ uw }: { uw: Underwriting }) {
  const prob = readProbability(uw.model);
  const assumptions = readAssumptions(uw.model);

  return (
    <div className="rounded-lg border border-line/60 bg-surface-2 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-fg-primary">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">{uw.scenario}</span>
          <span className="ml-2 text-fg-secondary">{uw.name}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <RecordLifecycleActions
            hub="run"
            module="underwriting"
            table="underwritings"
            id={uw.id}
            deleteClassName=""
          />
          <ActionForm action={setUnderwritingProbability} className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={uw.id} />
            <span className={labelClass}>Prob.</span>
            <input
              name="probability"
              defaultValue={prob ?? ""}
              placeholder="0.0–1.0"
              inputMode="decimal"
              className={`${fieldClass} w-20`}
              aria-label="Probability weight"
            />
            <button className="rounded-md border border-line px-2 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/60 hover:text-gold-300">
              Set
            </button>
          </ActionForm>
          <ActionForm action={setUnderwritingEquity} className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={uw.id} />
            <span className={labelClass}>Equity</span>
            <input
              name="equity_required"
              defaultValue={uw.equity_required ?? ""}
              placeholder="0"
              inputMode="decimal"
              className={`${fieldClass} w-24`}
              aria-label="Equity required"
            />
            <button className="rounded-md border border-line px-2 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/60 hover:text-gold-300">
              Set
            </button>
          </ActionForm>
        </div>
      </div>
      <UnderwritingCalculator
        caseId={uw.id}
        initial={{
          equity: assumptions.equity ?? uw.equity_required ?? null,
          exitValue: assumptions.exitValue ?? null,
          exitMultiple: assumptions.exitMultiple ?? null,
          holdYears: assumptions.holdYears ?? null,
          leverage: assumptions.leverage ?? null,
        }}
      />
    </div>
  );
}

// --- One deal's full underwriting panel ------------------------------------
function DealPanel({
  dealId,
  dealName,
  cases,
}: {
  dealId: string;
  dealName: string;
  cases: Underwriting[];
}) {
  // Probability-weighted expected return across this deal's cases.
  const weightInputs: WeightedCase[] = cases.map((u) => ({
    weight: readProbability(u.model) ?? 0,
    projected_irr: u.projected_irr,
    projected_moic: u.projected_moic,
  }));
  const weighted = weightedReturn(weightInputs);
  const hasWeights = weighted.totalWeight > 0 && weighted.contributing > 0;

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href={`/deal/${dealId}`} className="text-sm font-medium text-fg-primary hover:text-gold-300">
          {dealName}
          <span className="ml-2 text-xs text-fg-muted">
            {cases.length} case{cases.length === 1 ? "" : "s"}
          </span>
        </Link>
        {hasWeights && (
          <div className="text-right font-mono text-sm">
            <span className={labelClass}>Expected</span>{" "}
            <span className="text-gold-300">
              {weighted.irrPct != null ? `${weighted.irrPct}% IRR` : "— IRR"}
            </span>
            {weighted.moic != null && <span className="text-fg-secondary"> · {weighted.moic}x</span>}
          </div>
        )}
      </div>

      <ScenarioComparison dealId={dealId} cases={cases} />

      <div className="mt-3 space-y-2">
        {[...cases]
          .sort(
            (a, b) =>
              SCENARIO_ORDER.indexOf(a.scenario as never) - SCENARIO_ORDER.indexOf(b.scenario as never),
          )
          .map((u) => (
            <CaseControls key={u.id} uw={u} />
          ))}
      </div>
    </div>
  );
}

// --- Run › Underwriting: org-wide cases, now actionable --------------------
export async function RunUnderwritingModule({ orgId }: { orgId: string }) {
  const supabase = await createServerClient();
  const [deals, uwRes] = await Promise.all([
    activeDeals(orgId),
    supabase
      .from("underwritings")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const cases = (uwRes.data ?? []) as Underwriting[];
  const nameById = new Map(deals.map((d) => [d.id, d.name]));

  // Pipeline-wide equity roll-up (sum of each deal's base-case equity).
  const equity = rollupEquityRequired(cases);

  // Group cases by deal, ordering deals to match the picker (active deals
  // first, in their order), so the panels read top-down like the pipeline.
  const grouped = groupByDeal(cases);
  const orderedDealIds = [
    ...deals.map((d) => d.id).filter((id) => grouped.has(id)),
    ...[...grouped.keys()].filter((id) => !nameById.has(id)),
  ];

  return (
    <div>
      <ModuleHeader title="Underwriting" blurb="Base, bull, and bear cases behind every investment decision — compare scenarios, weight outcomes, and model returns." />
      {deals.length === 0 ? (
        <NoDeals what="underwrite" />
      ) : (
        <>
          <ActionForm
            action={addUnderwriting}
            className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-1 p-3"
          >
            <DealPicker deals={deals} />
            <select name="scenario" className={fieldClass} defaultValue="base" aria-label="Scenario">
              <option value="base">Base</option>
              <option value="upside">Upside</option>
              <option value="downside">Downside</option>
              <option value="stress">Stress</option>
            </select>
            <input name="name" placeholder="Label" className={`${fieldClass} w-28`} />
            <input name="projected_irr" placeholder="IRR %" className={`${fieldClass} w-20`} inputMode="decimal" />
            <input name="projected_moic" placeholder="MOIC" className={`${fieldClass} w-20`} inputMode="decimal" />
            <input
              name="equity_required"
              placeholder="Equity"
              className={`${fieldClass} w-24`}
              inputMode="decimal"
            />
            <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
              Add case
            </button>
          </ActionForm>

          {/* Pipeline-wide equity roll-up */}
          {equity.dealsWithEquity > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-gold-500/30 bg-surface-1 px-4 py-3">
              <span className={labelClass}>Pipeline equity required (base cases)</span>
              <span className="font-mono text-base text-gold-300">
                {fmtMoney(equity.totalEquityRequired)}
                <span className="ml-2 text-xs text-fg-muted">
                  across {equity.dealsWithEquity} deal{equity.dealsWithEquity === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          )}

          {cases.length === 0 ? (
            <p className="text-sm text-fg-muted">No underwriting models yet — add the first case above.</p>
          ) : (
            <div className="space-y-4">
              {orderedDealIds.map((dealId) => (
                <DealPanel
                  key={dealId}
                  dealId={dealId}
                  dealName={nameById.get(dealId) ?? "Unknown deal"}
                  cases={grouped.get(dealId) ?? []}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
