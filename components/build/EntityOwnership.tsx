"use client";

import { useMemo, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { rollupOwnership } from "@/lib/entity-ownership";
import type { EquityHolding } from "@/lib/supabase/database.types";
import {
  addStakeholder,
  addShareClass,
  addHolding,
  deleteHolding,
  draftOwnershipWithEarn,
} from "./ownership-actions";

export interface EntityLite { id: string; name: string; entity_type: string }
export interface StakeLite { id: string; name: string; kind: string }
export interface ClassLite { id: string; entity_id: string; name: string }

const BAR_COLORS = ["#D4AF6A", "#5B9BD5", "#5FB87A", "#D6A24A", "#A98BD6", "#D46A5A", "#6AC2C2"];

function usd(n: number | null): string {
  if (!n) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function EntityOwnership({
  entities,
  stakeholders,
  shareClasses,
  holdings,
}: {
  entities: EntityLite[];
  stakeholders: StakeLite[];
  shareClasses: ClassLite[];
  holdings: EquityHolding[];
}) {
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [desc, setDesc] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const entityHoldings = useMemo(() => holdings.filter((h) => h.entity_id === entityId), [holdings, entityId]);
  const entityClasses = useMemo(() => shareClasses.filter((c) => c.entity_id === entityId), [shareClasses, entityId]);
  const rollup = useMemo(
    () => rollupOwnership(entityHoldings, stakeholders, shareClasses),
    [entityHoldings, stakeholders, shareClasses],
  );

  if (entities.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm text-fg-muted">
        Add an entity above to start building its cap table.
      </div>
    );
  }

  function draft() {
    setNote(null);
    startTransition(async () => {
      const res = await draftOwnershipWithEarn(entityId, desc);
      if ("error" in res) setNote(res.error);
      else {
        setDesc("");
        setNote(`Earn added ${res.created} holder${res.created === 1 ? "" : "s"} — review below.`);
      }
    });
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Ownership &amp; Cap Table</h3>
        <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={`${inputClass} ml-auto w-auto`}>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {/* Ownership chart */}
      {rollup.rows.length > 0 ? (
        <div className="mb-3 rounded-xl border border-line bg-surface-1 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Fully-diluted ownership</span>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                rollup.balanced ? "border-emerald-400/40 text-emerald-300" : "border-status-warning/40 text-status-warning"
              }`}
            >
              {rollup.totalPct}% {rollup.balanced ? "balanced" : "of 100"}
            </span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
            {rollup.rows.map((r, i) => (
              <div
                key={r.holdingId}
                title={`${r.name} · ${r.ownershipPct}%`}
                style={{ width: `${r.ownershipPct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Cap table */}
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              {["Holder", "Class", "Units", "Own %", "Invested", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rollup.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-fg-muted">
                  No holders yet. Add one below or draft with Earn.
                </td>
              </tr>
            ) : (
              rollup.rows.map((r, i) => (
                <tr key={r.holdingId} className="border-b border-line/60 bg-surface-1">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                      <span className="text-fg-primary">{r.name}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{r.kind}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{r.className ?? "—"}</td>
                  <td className="px-3 py-2 text-fg-secondary">{r.units ?? "—"}</td>
                  <td className="px-3 py-2 font-medium text-fg-primary">{r.ownershipPct}%</td>
                  <td className="px-3 py-2 text-fg-secondary">{usd(r.investedAmount)}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={deleteHolding}>
                      <input type="hidden" name="id" value={r.holdingId} />
                      <button className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400">✕</button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add holding */}
      <form action={addHolding} className="mt-3 grid gap-2 rounded-xl border border-line bg-surface-1 p-3 sm:grid-cols-6">
        <input type="hidden" name="entity_id" value={entityId} />
        <select name="stakeholder_id" className={`${inputClass} sm:col-span-2`} defaultValue="">
          <option value="" disabled>Holder…</option>
          {stakeholders.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select name="share_class_id" className={inputClass} defaultValue="">
          <option value="">Class…</option>
          {entityClasses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input name="units" type="number" step="any" placeholder="Units" className={inputClass} />
        <input name="ownership_pct" type="number" step="any" placeholder="Own %" className={inputClass} />
        <button className="rounded-md bg-gold-400 px-3 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300">Add</button>
      </form>

      {/* Quick add stakeholder + share class */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <form action={addStakeholder} className="flex gap-2 rounded-xl border border-line bg-surface-1 p-3">
          <input name="name" placeholder="New stakeholder name" className={`${inputClass} flex-1`} />
          <select name="kind" defaultValue="person" className={inputClass}>
            {["person", "entity", "investor", "fund", "pool", "other"].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button className="rounded-md border border-line px-3 py-2 text-sm text-fg-secondary transition hover:text-fg-primary">+ Holder</button>
        </form>
        <form action={addShareClass} className="flex gap-2 rounded-xl border border-line bg-surface-1 p-3">
          <input type="hidden" name="entity_id" value={entityId} />
          <input name="name" placeholder="New share class (e.g. Common)" className={`${inputClass} flex-1`} />
          <select name="kind" defaultValue="common" className={inputClass}>
            {["common", "preferred", "lp_interest", "gp_interest", "membership", "option", "safe", "other"].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button className="rounded-md border border-line px-3 py-2 text-sm text-fg-secondary transition hover:text-fg-primary">+ Class</button>
        </form>
      </div>

      {/* Earn draft */}
      <div className="mt-2 rounded-xl border border-gold-500/30 bg-gold-500/5 p-3">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-400">Draft with Earn</p>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={2}
          placeholder="Describe the ownership, e.g. 'Jane 60%, partner pool 20%, co-GP 20%' — Earn builds the cap table."
          className={`${inputClass} w-full resize-y`}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={draft}
            disabled={pending || !desc.trim()}
            className="rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
          >
            {pending ? "Earn is building…" : "✶ Build cap table"}
          </button>
          {note ? <span className="text-xs text-fg-secondary">{note}</span> : null}
        </div>
      </div>
    </div>
  );
}
