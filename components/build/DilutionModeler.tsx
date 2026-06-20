"use client";

import { useMemo, useState } from "react";
import { inputClass } from "./DraftWithEarn";
import { rollupOwnership } from "@/lib/entity-ownership";
import { modelRound } from "@/lib/dilution";
import type { EquityHolding } from "@/lib/supabase/database.types";

interface EntityLite {
  id: string;
  name: string;
}
interface StakeLite {
  id: string;
  name: string;
  kind: string;
}
interface ClassLite {
  id: string;
  name: string;
}

const BAR_COLORS = ["#D4AF6A", "#5B9BD5", "#5FB87A", "#D6A24A", "#A98BD6", "#D46A5A", "#6AC2C2"];

function usd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function DilutionModeler({
  entities,
  holdings,
  stakeholders,
  shareClasses,
}: {
  entities: EntityLite[];
  holdings: EquityHolding[];
  stakeholders: StakeLite[];
  shareClasses: ClassLite[];
}) {
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [preMoney, setPreMoney] = useState("10000000");
  const [raiseAmount, setRaiseAmount] = useState("2500000");
  const [newInvestorName, setNewInvestorName] = useState("");
  const [optionPoolPct, setOptionPoolPct] = useState("0");

  const entityHoldings = useMemo(
    () => holdings.filter((h) => h.entity_id === entityId),
    [holdings, entityId],
  );

  const rollup = useMemo(
    () => rollupOwnership(entityHoldings, stakeholders, shareClasses),
    [entityHoldings, stakeholders, shareClasses],
  );

  const current = useMemo(
    () => rollup.rows.map((r) => ({ name: r.name, pct: r.ownershipPct })),
    [rollup],
  );

  const result = useMemo(
    () =>
      modelRound(current, {
        preMoney: num(preMoney),
        raiseAmount: num(raiseAmount),
        newInvestorName,
        optionPoolPct: num(optionPoolPct),
      }),
    [current, preMoney, raiseAmount, newInvestorName, optionPoolPct],
  );

  if (entities.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm text-fg-muted">
        Add an entity above to model a financing round.
      </div>
    );
  }

  const hasRound = num(raiseAmount) > 0 || num(optionPoolPct) > 0;

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
          Scenario &amp; Dilution
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          model a priced round
        </span>
        <select
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className={`${inputClass} ml-auto w-auto`}
        >
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {/* Inputs */}
      <div className="grid gap-2 rounded-xl border border-line bg-surface-1 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Pre-money</span>
          <input
            type="number"
            step="any"
            min={0}
            value={preMoney}
            onChange={(e) => setPreMoney(e.target.value)}
            className={inputClass}
            placeholder="10,000,000"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Raise amount</span>
          <input
            type="number"
            step="any"
            min={0}
            value={raiseAmount}
            onChange={(e) => setRaiseAmount(e.target.value)}
            className={inputClass}
            placeholder="2,500,000"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">New investor</span>
          <input
            type="text"
            value={newInvestorName}
            onChange={(e) => setNewInvestorName(e.target.value)}
            className={inputClass}
            placeholder="New Investor"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Option pool % (post)</span>
          <input
            type="number"
            step="any"
            min={0}
            max={100}
            value={optionPoolPct}
            onChange={(e) => setOptionPoolPct(e.target.value)}
            className={inputClass}
            placeholder="0"
          />
        </label>
      </div>

      {/* Round summary */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Post-money", value: usd(result.postMoney) },
          { label: "New investor", value: `${result.newInvestorPct}%` },
          { label: "Option pool", value: `${result.optionPoolPct}%` },
          {
            label: "Existing retain",
            value: `${Math.round(result.dilutionFactor * 10000) / 100}%`,
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{s.label}</div>
            <div className="mt-0.5 text-sm font-medium text-fg-primary">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Post-round stacked bar */}
      {result.rows.length > 0 ? (
        <div className="mt-3 rounded-xl border border-line bg-surface-1 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Post-round ownership
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
            {result.rows.map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                title={`${r.name} · ${r.postPct}%`}
                style={{ width: `${r.postPct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Before -> after table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              {["Holder", "Pre %", "Post %", "Δ"].map((h) => (
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
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-fg-muted">
                  {hasRound
                    ? "No holders to model — add holdings to this entity first."
                    : "Enter a raise amount to model dilution."}
                </td>
              </tr>
            ) : (
              result.rows.map((r, i) => {
                const isNew = r.premPct === 0 && r.deltaPct === 0;
                const deltaColor =
                  r.deltaPct > 0
                    ? "text-status-success"
                    : r.deltaPct < 0
                    ? "text-status-warning"
                    : "text-fg-muted";
                return (
                  <tr key={`${r.name}-${i}`} className="border-b border-line/60 bg-surface-1">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                        />
                        <span className="text-fg-primary">{r.name}</span>
                        {isNew ? (
                          <span className="rounded-full border border-gold-500/40 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gold-300">
                            new
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-secondary">{r.premPct}%</td>
                    <td className="px-3 py-2 font-medium text-fg-primary">{r.postPct}%</td>
                    <td className={`px-3 py-2 font-mono text-xs ${deltaColor}`}>
                      {r.deltaPct > 0 ? "+" : ""}
                      {r.deltaPct === 0 ? "—" : `${r.deltaPct} pp`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-fg-muted">
        Pro-forma assumes the option pool is created pre-money; existing holders are diluted
        pro-rata. Figures are modeling estimates, not legal cap-table records.
      </p>
    </div>
  );
}
