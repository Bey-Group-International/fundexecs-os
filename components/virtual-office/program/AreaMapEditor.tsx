"use client";

import { useMemo, useState } from "react";
import { FloorOverlay } from "./FloorOverlay";
import type { AreaTrigger, ScriptedArea } from "@/lib/office/scriptedAreas";
import {
  AREA_TRIGGER_KINDS,
  loadScriptedAreas,
  resetScriptedAreas,
  saveScriptedAreas,
  validateAreas,
} from "@/lib/office/areaStore";

const GOLD = "#c9a84c";

const inputCls =
  "w-full rounded-md border px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-600 focus:outline-none";
const inputStyle = { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" } as const;
const labelCls = "mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500";

const TRIGGER_LABELS: Record<AreaTrigger["kind"], string> = {
  say: "Say (speech bubble)",
  toast: "Toast (activity feed)",
  "start-meeting": "Start meeting",
  broadcast: "Broadcast (all-hands)",
};

/** A fresh trigger of the given kind, preserving text where it applies. */
function triggerOfKind(kind: AreaTrigger["kind"], prevText: string): AreaTrigger {
  if (kind === "start-meeting") return { kind };
  return { kind, text: prevText };
}

/** Allocate an area id that doesn't collide with the current set. */
function nextAreaId(areas: ScriptedArea[]): string {
  const used = new Set(areas.map((a) => a.id));
  for (let i = areas.length + 1; ; i++) {
    const id = `area-${i}`;
    if (!used.has(id)) return id;
  }
}

/**
 * WorkAdventure-style map editor, scoped to scripted areas. Lists the current
 * areas and lets the operator add / edit / move / resize / remove them, with the
 * built-in `SCRIPTED_AREAS` as the seed. Each valid change is persisted to
 * localStorage via the area store, which emits an event the Phaser scene reacts
 * to — so the floor markers and walk-in triggers update live.
 */
export function AreaMapEditor({ onClose }: { onClose: () => void }) {
  const [areas, setAreas] = useState<ScriptedArea[]>(() => loadScriptedAreas());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadScriptedAreas()[0]?.id ?? null);

  // The persisted validity of the whole set — an in-progress edit (e.g. a blank
  // label) shows this error and simply isn't written to the floor until fixed.
  const persistError = useMemo(() => {
    const res = validateAreas(areas);
    return res.ok ? null : res.error;
  }, [areas]);

  const selected = areas.find((a) => a.id === selectedId) ?? null;

  /** Update local state and persist; persistence no-ops while the set is invalid. */
  const commit = (next: ScriptedArea[]) => {
    setAreas(next);
    saveScriptedAreas(next); // validates internally + emits the live-update event
  };

  const patchSelected = (patch: Partial<ScriptedArea>) => {
    if (!selected) return;
    commit(areas.map((a) => (a.id === selected.id ? { ...a, ...patch } : a)));
  };

  const setNumber = (key: "x" | "y" | "w" | "h", raw: string) => {
    const n = Number(raw);
    patchSelected({ [key]: Number.isFinite(n) ? n : 0 } as Partial<ScriptedArea>);
  };

  const addArea = () => {
    const id = nextAreaId(areas);
    const area: ScriptedArea = {
      id,
      label: "New area",
      x: 40,
      y: 40,
      w: 120,
      h: 96,
      accent: GOLD,
      trigger: { kind: "toast", text: "You entered a new area" },
    };
    commit([...areas, area]);
    setSelectedId(id);
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = areas.filter((a) => a.id !== selected.id);
    commit(next);
    setSelectedId(next[0]?.id ?? null);
  };

  const resetAll = () => {
    const defaults = resetScriptedAreas();
    setAreas(defaults);
    setSelectedId(defaults[0]?.id ?? null);
  };

  return (
    <FloorOverlay
      accent={GOLD}
      onClose={onClose}
      ariaLabel="Map editor"
      maxWidth={460}
      eyebrow="Map editor"
      title="Scripted areas"
      subtitle="Author the walk-in zones on the floor. Changes apply live."
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={resetAll}
            className="rounded border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity"
            style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            Done
          </button>
        </div>
      }
    >
      {/* Area list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelCls}>Areas ({areas.length})</span>
          <button
            type="button"
            onClick={addArea}
            className="rounded px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors"
            style={{ color: GOLD, border: `1px solid ${GOLD}59`, background: `${GOLD}14` }}
          >
            + Add area
          </button>
        </div>
        {areas.length === 0 && (
          <p className="text-[11px] text-slate-500">No areas yet — add one to place a walk-in zone.</p>
        )}
        <div className="space-y-1">
          {areas.map((a) => {
            const active = a.id === selectedId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors"
                style={{
                  borderColor: active ? `${GOLD}80` : "rgba(255,255,255,0.08)",
                  background: active ? `${GOLD}14` : "rgba(255,255,255,0.02)",
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: a.accent ?? GOLD }}
                  />
                  <span className="truncate text-[12px] text-slate-100">{a.label || "(untitled)"}</span>
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-500">{a.trigger.kind}</span>
              </button>
            );
          })}
        </div>
      </div>

      {persistError && (
        <p className="text-[10px]" style={{ color: "#f59e0b" }}>
          Not saved to the floor yet: {persistError}
        </p>
      )}

      {/* Editor for the selected area */}
      {selected && (
        <div className="space-y-2.5 rounded-lg border px-3 py-3" style={{ borderColor: `${GOLD}2e` }}>
          <label className="block">
            <span className={labelCls}>Label</span>
            <input
              value={selected.label}
              onChange={(e) => patchSelected({ label: e.target.value })}
              placeholder="Area label"
              className={inputCls}
              style={inputStyle}
            />
          </label>

          <div className="grid grid-cols-4 gap-2">
            {(["x", "y", "w", "h"] as const).map((key) => (
              <label key={key} className="block">
                <span className={labelCls}>{key === "w" ? "Width" : key === "h" ? "Height" : key.toUpperCase()}</span>
                <input
                  type="number"
                  value={selected[key]}
                  onChange={(e) => setNumber(key, e.target.value)}
                  className={inputCls}
                  style={inputStyle}
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelCls}>Trigger</span>
              <select
                value={selected.trigger.kind}
                onChange={(e) =>
                  patchSelected({
                    trigger: triggerOfKind(
                      e.target.value as AreaTrigger["kind"],
                      "text" in selected.trigger ? selected.trigger.text : "",
                    ),
                  })
                }
                className={inputCls}
                style={inputStyle}
              >
                {AREA_TRIGGER_KINDS.map((k) => (
                  <option key={k} value={k} style={{ background: "#0a0806" }}>
                    {TRIGGER_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Accent</span>
              <input
                type="color"
                value={selected.accent ?? GOLD}
                onChange={(e) => patchSelected({ accent: e.target.value })}
                className="h-[32px] w-full cursor-pointer rounded-md border bg-transparent"
                style={{ borderColor: "rgba(255,255,255,0.1)" }}
              />
            </label>
          </div>

          {"text" in selected.trigger && (
            <label className="block">
              <span className={labelCls}>Trigger text</span>
              <textarea
                value={selected.trigger.text}
                onChange={(e) => patchSelected({ trigger: { kind: selected.trigger.kind, text: e.target.value } as AreaTrigger })}
                rows={2}
                placeholder="What the zone says / announces on enter"
                className={`${inputCls} resize-none`}
                style={inputStyle}
              />
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={selected.once === true}
              onChange={(e) => patchSelected({ once: e.target.checked ? true : undefined })}
              className="h-3.5 w-3.5"
              style={{ accentColor: GOLD }}
            />
            <span>
              Fire once per session <span className="text-slate-500">— else re-fires on re-entry</span>
            </span>
          </label>

          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={removeSelected}
              className="rounded border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors"
              style={{ borderColor: "#ef444455", color: "#ef4444" }}
            >
              Remove area
            </button>
          </div>
        </div>
      )}
    </FloorOverlay>
  );
}
