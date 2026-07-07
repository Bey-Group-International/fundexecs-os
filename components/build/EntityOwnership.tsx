"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { rollupOwnership } from "@/lib/entity-ownership";
import { holdingsToCsv, parseHoldingsCsv, csvFilenameStem } from "@/lib/holdings-csv";
import { ACCEPTED_UPLOAD_ATTR, readFileHead, validateFileType } from "@/lib/file-validation";
import { xlsxToRows, rowsToCsv } from "@/lib/xlsx";
import type { EquityHolding } from "@/lib/supabase/database.types";
import {
  addStakeholder,
  addShareClass,
  addHolding,
  deleteStakeholder,
  deleteHolding,
  updateHolding,
  draftOwnershipWithEarn,
  importHoldingsCsv,
} from "./ownership-actions";

interface HoldingDraft {
  units: string;
  ownership_pct: string;
  invested_amount: string;
  share_class_id: string;
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<HoldingDraft>({
    units: "",
    ownership_pct: "",
    invested_amount: "",
    share_class_id: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, startSaveTransition] = useTransition();
  // Optimistic overlay applied on top of server holdings between a save and the
  // revalidated refresh. Cleared whenever fresh server data arrives.
  const [overrides, setOverrides] = useState<Record<string, Partial<EquityHolding>>>({});
  useEffect(() => setOverrides({}), [holdings]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveHoldings = useMemo(
    () =>
      Object.keys(overrides).length === 0
        ? holdings
        : holdings.map((h) => (overrides[h.id] ? { ...h, ...overrides[h.id] } : h)),
    [holdings, overrides],
  );

  const entityHoldings = useMemo(() => effectiveHoldings.filter((h) => h.entity_id === entityId), [effectiveHoldings, entityId]);
  const entityClasses = useMemo(() => shareClasses.filter((c) => c.entity_id === entityId), [shareClasses, entityId]);
  const holdingById = useMemo(
    () => new Map(entityHoldings.map((h) => [h.id, h])),
    [entityHoldings],
  );
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

  // Download the selected entity's cap table as CSV, client-side.
  function exportCsv() {
    if (rollup.rows.length === 0) {
      setNote("No holders to export yet.");
      return;
    }
    const csv = holdingsToCsv(
      rollup.rows.map((r) => ({
        name: r.name,
        kind: r.kind,
        className: r.className,
        units: r.units,
        ownershipPct: r.ownershipPct,
        investedAmount: r.investedAmount,
      })),
    );
    const entityName = entities.find((e) => e.id === entityId)?.name ?? "entity";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvFilenameStem(entityName)}-cap-table.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Read a chosen CSV/XLSX client-side, parse it, and import via the server action.
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    setNote(null);

    const head = await readFileHead(file);
    const check = validateFileType({ name: file.name, mime: file.type, head }, { accept: ["csv", "xlsx"] });
    if (!check.ok) {
      setNote(check.error);
      return;
    }

    let csvText: string;
    try {
      if (check.kind === "xlsx") {
        const bytes = new Uint8Array(await file.arrayBuffer());
        csvText = rowsToCsv(await xlsxToRows(bytes));
      } else {
        csvText = await file.text();
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't read that file.");
      return;
    }

    const rows = parseHoldingsCsv(csvText);
    if (rows.length === 0) {
      setNote("No rows found in that file.");
      return;
    }
    startTransition(async () => {
      const res = await importHoldingsCsv(entityId, rows);
      if ("error" in res) setNote(res.error);
      else setNote(`Imported ${res.created} holder${res.created === 1 ? "" : "s"} — review below.`);
    });
  }

  function startEdit(holdingId: string) {
    const h = holdingById.get(holdingId);
    setEditError(null);
    setEditDraft({
      units: h?.units != null ? String(h.units) : "",
      ownership_pct: h?.ownership_pct != null ? String(h.ownership_pct) : "",
      invested_amount: h?.invested_amount != null ? String(h.invested_amount) : "",
      share_class_id: h?.share_class_id ?? "",
    });
    setEditingId(holdingId);
  }

  function cancelEdit() {
    setEditError(null);
    setEditingId(null);
  }

  // Mirror the server's number parsing (commas/spaces stripped) for validation.
  function validateDraft(d: HoldingDraft): string | null {
    const pct = d.ownership_pct.trim();
    if (pct !== "") {
      const n = Number(pct.replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return "Ownership % must be a number.";
      if (n < 0 || n > 100) return "Ownership % must be between 0 and 100.";
    }
    for (const [label, raw] of [
      ["Units", d.units],
      ["Invested", d.invested_amount],
    ] as const) {
      const v = raw.trim();
      if (v !== "" && !Number.isFinite(Number(v.replace(/[, ]/g, "")))) {
        return `${label} must be a number.`;
      }
    }
    return null;
  }

  // Match the server's num() coercion so the optimistic value equals what the
  // revalidated read will return.
  function parseNum(raw: string): number | null {
    const v = raw.trim();
    if (v === "") return null;
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function saveEdit() {
    if (!editingId) return;
    const err = validateDraft(editDraft);
    if (err) {
      setEditError(err);
      return;
    }
    setEditError(null);
    const id = editingId;
    const fd = new FormData();
    fd.set("id", id);
    fd.set("units", editDraft.units);
    fd.set("ownership_pct", editDraft.ownership_pct);
    fd.set("invested_amount", editDraft.invested_amount);
    fd.set("share_class_id", editDraft.share_class_id);

    // Reflect the change instantly, then confirm (or roll back) with the server.
    const optimistic: Partial<EquityHolding> = {
      units: parseNum(editDraft.units),
      ownership_pct: parseNum(editDraft.ownership_pct),
      invested_amount: parseNum(editDraft.invested_amount),
      share_class_id: editDraft.share_class_id || null,
    };
    setOverrides((o) => ({ ...o, [id]: optimistic }));
    setEditingId(null);

    startSaveTransition(async () => {
      const res = await updateHolding(fd);
      if (res && "error" in res) {
        setOverrides((o) => {
          const next = { ...o };
          delete next[id];
          return next;
        });
        setEditError(res.error);
        setEditingId(id);
      }
    });
  }

  function onEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!savingId) saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Ownership &amp; Cap Table</h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={`${inputClass} w-auto`} aria-label="Select entity">
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-line px-3 py-2 text-sm text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            className="rounded-md border border-line px-3 py-2 text-sm text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-60"
          >
            {pending ? "Importing…" : "Import CSV / XLSX"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_UPLOAD_ATTR}
            onChange={onImportFile}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
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
              rollup.rows.map((r, i) => {
                const editing = editingId === r.holdingId;
                return (
                  <Fragment key={r.holdingId}>
                  <tr
                    className="border-b border-line/60 bg-surface-1"
                    onKeyDown={editing ? onEditKeyDown : undefined}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                        <span className="text-fg-primary">{r.name}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{r.kind}</span>
                      </span>
                    </td>
                    {editing ? (
                      <>
                        <td className="px-3 py-2">
                          <select
                            value={editDraft.share_class_id}
                            onChange={(e) => setEditDraft((d) => ({ ...d, share_class_id: e.target.value }))}
                            className={`${inputClass} w-full`}
                          >
                            <option value="">Class…</option>
                            {entityClasses.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="any"
                            value={editDraft.units}
                            onChange={(e) => setEditDraft((d) => ({ ...d, units: e.target.value }))}
                            placeholder="Units"
                            className={`${inputClass} w-24`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="any"
                            value={editDraft.ownership_pct}
                            onChange={(e) => setEditDraft((d) => ({ ...d, ownership_pct: e.target.value }))}
                            placeholder="Own %"
                            className={`${inputClass} w-20`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="any"
                            value={editDraft.invested_amount}
                            onChange={(e) => setEditDraft((d) => ({ ...d, invested_amount: e.target.value }))}
                            placeholder="Invested"
                            className={`${inputClass} w-28`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={savingId}
                              className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-xs text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-60"
                              aria-label="Save holding"
                            >
                              {savingId ? "…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={savingId}
                              className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted transition hover:text-fg-primary disabled:opacity-60"
                              aria-label="Cancel edit"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-fg-secondary">{r.className ?? "—"}</td>
                        <td className="px-3 py-2 text-fg-secondary">{r.units ?? "—"}</td>
                        <td className="px-3 py-2 font-medium text-fg-primary">{r.ownershipPct}%</td>
                        <td className="px-3 py-2 text-fg-secondary">{usd(r.investedAmount)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(r.holdingId)}
                              className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
                              aria-label={`Edit ${r.name}`}
                            >
                              Edit
                            </button>
                            <form
                              action={deleteHolding}
                              onSubmit={(event) => {
                                if (!confirm(`Remove ${r.name} from the cap table?`)) event.preventDefault();
                              }}
                            >
                              <input type="hidden" name="id" value={r.holdingId} />
                              <button className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400" aria-label={`Delete ${r.name}`}>✕</button>
                            </form>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                  {editing && editError && (
                    <tr className="bg-surface-1">
                      <td colSpan={6} className="px-3 pb-2 pt-0">
                        <p className="text-xs text-red-400">{editError}</p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
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

      {stakeholders.length > 0 ? (
        <div className="mt-2 rounded-xl border border-line bg-surface-1 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Stakeholder registry
          </div>
          <div className="flex flex-wrap gap-2">
            {stakeholders.map((s) => (
              <form
                key={s.id}
                action={deleteStakeholder}
                onSubmit={(event) => {
                  if (!confirm(`Delete stakeholder "${s.name}" permanently?`)) event.preventDefault();
                }}
                className="flex items-center gap-2 rounded-full border border-line bg-surface-0 px-2.5 py-1 text-xs"
              >
                <input type="hidden" name="id" value={s.id} />
                <span className="text-fg-primary">{s.name}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{s.kind}</span>
                <button className="text-status-danger transition hover:text-red-300" aria-label={`Delete ${s.name}`}>
                  Delete
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

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
