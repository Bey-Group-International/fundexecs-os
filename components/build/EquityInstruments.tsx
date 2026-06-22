"use client";

import { useMemo, useState } from "react";
import { inputClass } from "./DraftWithEarn";
import { vestingSummary, type VestingFrequency } from "@/lib/vesting";
import { convert, type InstrumentType } from "@/lib/convertibles";
import { recognizedExpense } from "@/lib/stock-comp";
import { runEquityWithEarn } from "./equity-actions";

// Build › Entity: the equity-issuance bench for the firm's own vehicles — the
// engines Carta runs for grants and SAFEs, native here. Three interactive
// calculators over the pure engines: option/RSU vesting, SAFE/note conversion
// into a priced round, and ASC 718 stock-comp expense. Modeling surfaces — no
// persistence, no legal cap-table or accounting record.

function usd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function units(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

// Hand the modeled scenario to the agent team, mirroring Execute's "Run with
// Earn" launchers. The live inputs/outputs ride along as context.
function EarnButton({ kind, scenario }: { kind: string; scenario: string }) {
  return (
    <form action={runEquityWithEarn} className="mt-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="scenario" value={scenario} />
      <button className="inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 hover:text-gold-200">
        ✶ Run with Earn
      </button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-fg-primary">{value}</div>
    </div>
  );
}

const TODAY = new Date().toISOString().slice(0, 10);

export function EquityInstruments() {
  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
          Equity Issuance
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          grants · SAFEs · stock comp
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <VestingCalc />
        <ConvertibleCalc />
        <StockCompCalc />
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        Interactive modeling over the firm&apos;s own vehicles — vesting accrual, conversion math,
        and straight-line ASC 718 recognition. Estimates, not legal cap-table or accounting records.
      </p>
    </div>
  );
}

// --- Option / RSU vesting ----------------------------------------------------
function VestingCalc() {
  const [totalUnits, setTotalUnits] = useState("40000");
  const [grantDate, setGrantDate] = useState("2024-01-15");
  const [cliffMonths, setCliffMonths] = useState("12");
  const [vestingMonths, setVestingMonths] = useState("48");
  const [frequency, setFrequency] = useState<VestingFrequency>("monthly");

  const s = useMemo(
    () =>
      vestingSummary(
        {
          totalUnits: num(totalUnits),
          grantDate,
          cliffMonths: num(cliffMonths),
          vestingMonths: num(vestingMonths),
          frequency,
        },
        TODAY,
      ),
    [totalUnits, grantDate, cliffMonths, vestingMonths, frequency],
  );

  return (
    <section className="rounded-xl border border-line bg-surface-1 p-4">
      <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">Vesting</h4>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Units granted">
          <input type="number" step="any" min={0} value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Grant date">
          <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Cliff (months)">
          <input type="number" step="any" min={0} value={cliffMonths} onChange={(e) => setCliffMonths(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Term (months)">
          <input type="number" step="any" min={0} value={vestingMonths} onChange={(e) => setVestingMonths(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Frequency">
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as VestingFrequency)} className={inputClass}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Vested today" value={`${units(s.vested)} · ${s.vestedPct}%`} />
        <Stat label="Unvested" value={units(s.unvested)} />
        <Stat label="Next tranche" value={s.nextVestDate ? `${units(s.nextVestUnits)} on ${s.nextVestDate}` : "—"} />
        <Stat label="Fully vested" value={s.fullyVestedOn ?? "—"} />
      </div>
      <EarnButton
        kind="vesting"
        scenario={`${units(num(totalUnits))} units granted ${grantDate}, ${num(cliffMonths)}-month cliff, ${num(vestingMonths)}-month ${frequency} vesting. As of ${TODAY}: ${units(s.vested)} vested (${s.vestedPct}%), ${units(s.unvested)} unvested; next tranche ${s.nextVestDate ? `${units(s.nextVestUnits)} on ${s.nextVestDate}` : "none"}; fully vested ${s.fullyVestedOn ?? "—"}.`}
      />
    </section>
  );
}

// --- SAFE / convertible note conversion -------------------------------------
function ConvertibleCalc() {
  const [type, setType] = useState<InstrumentType>("safe");
  const [principal, setPrincipal] = useState("500000");
  const [valuationCap, setValuationCap] = useState("8000000");
  const [discount, setDiscount] = useState("20");
  const [interestRate, setInterestRate] = useState("6");
  const [issueDate, setIssueDate] = useState("2024-06-01");
  const [pricePerShare, setPricePerShare] = useState("1.50");
  const [preMoneyShares, setPreMoneyShares] = useState("10000000");

  const r = useMemo(
    () =>
      convert(
        {
          name: "Investor",
          type,
          principal: num(principal),
          valuationCap: num(valuationCap) || undefined,
          discount: num(discount) ? num(discount) / 100 : undefined,
          interestRate: type === "note" && num(interestRate) ? num(interestRate) / 100 : undefined,
          issueDate: type === "note" ? issueDate : undefined,
        },
        { pricePerShare: num(pricePerShare), preMoneyShares: num(preMoneyShares) },
        TODAY,
      ),
    [type, principal, valuationCap, discount, interestRate, issueDate, pricePerShare, preMoneyShares],
  );

  return (
    <section className="rounded-xl border border-line bg-surface-1 p-4">
      <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">SAFE / Note conversion</h4>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Instrument">
          <select value={type} onChange={(e) => setType(e.target.value as InstrumentType)} className={inputClass}>
            <option value="safe">SAFE</option>
            <option value="note">Conv. note</option>
          </select>
        </Field>
        <Field label="Principal">
          <input type="number" step="any" min={0} value={principal} onChange={(e) => setPrincipal(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Valuation cap">
          <input type="number" step="any" min={0} value={valuationCap} onChange={(e) => setValuationCap(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Discount %">
          <input type="number" step="any" min={0} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} />
        </Field>
        {type === "note" ? (
          <>
            <Field label="Interest %/yr">
              <input type="number" step="any" min={0} value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Issue date">
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputClass} />
            </Field>
          </>
        ) : null}
        <Field label="Round $/share">
          <input type="number" step="any" min={0} value={pricePerShare} onChange={(e) => setPricePerShare(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Pre-money shares">
          <input type="number" step="any" min={0} value={preMoneyShares} onChange={(e) => setPreMoneyShares(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Converts at" value={`$${r.conversionPrice} · ${r.basis}`} />
        <Stat label="Shares issued" value={units(r.sharesIssued)} />
        <Stat label="Accrued" value={usd(r.accrued)} />
        <Stat label="Ownership" value={`${r.ownershipPct}%`} />
      </div>
      <EarnButton
        kind="convertible"
        scenario={`${type === "note" ? "Convertible note" : "SAFE"} of ${usd(num(principal))} principal, cap ${usd(num(valuationCap))}, ${num(discount)}% discount${type === "note" ? `, ${num(interestRate)}%/yr interest from ${issueDate}` : ""}. Converting into a round at $${num(pricePerShare)}/share on ${units(num(preMoneyShares))} pre-money shares. Result: converts at $${r.conversionPrice} (${r.basis} governs), ${units(r.sharesIssued)} shares, ${r.ownershipPct}% ownership, accrued ${usd(r.accrued)}.`}
      />
    </section>
  );
}

// --- ASC 718 stock-comp expense ----------------------------------------------
function StockCompCalc() {
  const [unitsGranted, setUnitsGranted] = useState("40000");
  const [fairValuePerUnit, setFairValuePerUnit] = useState("4.20");
  const [grantDate, setGrantDate] = useState("2024-01-15");
  const [vestingMonths, setVestingMonths] = useState("48");
  const [forfeitureRate, setForfeitureRate] = useState("0");

  const r = useMemo(
    () =>
      recognizedExpense(
        {
          units: num(unitsGranted),
          fairValuePerUnit: num(fairValuePerUnit),
          grantDate,
          vestingMonths: num(vestingMonths),
          forfeitureRate: num(forfeitureRate) ? num(forfeitureRate) / 100 : undefined,
        },
        TODAY,
      ),
    [unitsGranted, fairValuePerUnit, grantDate, vestingMonths, forfeitureRate],
  );

  return (
    <section className="rounded-xl border border-line bg-surface-1 p-4">
      <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">ASC 718 expense</h4>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Units">
          <input type="number" step="any" min={0} value={unitsGranted} onChange={(e) => setUnitsGranted(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Grant-date FV/unit">
          <input type="number" step="any" min={0} value={fairValuePerUnit} onChange={(e) => setFairValuePerUnit(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Grant date">
          <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Term (months)">
          <input type="number" step="any" min={0} value={vestingMonths} onChange={(e) => setVestingMonths(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Forfeiture %">
          <input type="number" step="any" min={0} max={100} value={forfeitureRate} onChange={(e) => setForfeitureRate(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Total cost" value={usd(r.totalCost)} />
        <Stat label="Recognized" value={usd(r.recognized)} />
        <Stat label="Remaining" value={usd(r.remaining)} />
        <Stat label="Term elapsed" value={`${Math.round(r.vestedFraction * 100)}%`} />
      </div>
      <EarnButton
        kind="stock_comp"
        scenario={`${units(num(unitsGranted))} units at $${num(fairValuePerUnit)} grant-date fair value, granted ${grantDate}, ${num(vestingMonths)}-month vesting${num(forfeitureRate) ? `, ${num(forfeitureRate)}% forfeiture assumption` : ""}. As of ${TODAY}: total cost ${usd(r.totalCost)}, recognized ${usd(r.recognized)}, remaining ${usd(r.remaining)} (${Math.round(r.vestedFraction * 100)}% of term elapsed).`}
      />
    </section>
  );
}
