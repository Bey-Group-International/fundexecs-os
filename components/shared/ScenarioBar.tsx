"use client";

// components/shared/ScenarioBar.tsx
// Save / load / delete UI for a financial-model tool's scenarios. Shared by the
// LBO model (Run › Underwriting) and the fund-life waterfall (Execute ›
// Waterfall). The parent supplies its current serializable inputs via getInputs
// and restores state via onLoad; persistence goes through the org-scoped server
// actions.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveFinancialScenario,
  deleteFinancialScenario,
} from "@/lib/financial-scenario-actions";
import type { SavedScenario, ScenarioKind } from "@/lib/financial-scenarios";

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2 py-1 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

export function ScenarioBar({
  kind,
  saved,
  getInputs,
  onLoad,
}: {
  kind: ScenarioKind;
  saved: SavedScenario[];
  getInputs: () => Record<string, unknown>;
  onLoad: (inputs: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selId, setSelId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const n = name.trim();
    if (!n) {
      setError("Name your scenario first.");
      return;
    }
    start(async () => {
      const res = await saveFinancialScenario({ kind, name: n, inputs: getInputs() });
      if (res.error) setError(res.error);
      else {
        setName("");
        router.refresh();
      }
    });
  }

  function load(id: string) {
    setSelId(id);
    if (!id) return;
    const s = saved.find((x) => x.id === id);
    if (s) onLoad(s.inputs);
  }

  function del() {
    if (!selId) return;
    setError(null);
    start(async () => {
      const res = await deleteFinancialScenario(selId, kind);
      if (res.error) setError(res.error);
      else {
        setSelId("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-line/60 bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={labelClass}>Scenarios</span>
        {saved.length > 0 && (
          <>
            <select
              value={selId}
              onChange={(e) => load(e.target.value)}
              className={`${fieldClass} min-w-[140px]`}
              aria-label="Load scenario"
            >
              <option value="">Load saved…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {selId && (
              <button
                type="button"
                onClick={del}
                disabled={pending}
                className="rounded-md border border-status-danger/40 px-2 py-1 text-xs text-status-danger transition hover:bg-status-danger/10 disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </>
        )}
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this scenario"
          className={`${fieldClass} min-w-[160px] flex-1`}
          aria-label="Scenario name"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-gold-500 px-3 py-1 text-xs font-medium text-black transition hover:bg-gold-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="text-[11px] text-status-danger">{error}</p>}
    </div>
  );
}
