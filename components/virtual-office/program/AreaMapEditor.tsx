"use client";

import { useMemo, useRef, useState } from "react";
import { FloorOverlay } from "./FloorOverlay";
import { ROOMS, ROOM_W, ROOM_H, WORLD_W, WORLD_H } from "@/components/virtual-office/types";
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

  // Create an area from a drawn rectangle (minimap drag) and select it.
  const createAreaAt = (rect: Pick<ScriptedArea, "x" | "y" | "w" | "h">) => {
    const id = nextAreaId(areas);
    commit([
      ...areas,
      { id, label: "New area", ...rect, accent: GOLD, trigger: { kind: "toast", text: "You entered a new area" } },
    ]);
    setSelectedId(id);
  };

  // Persist a moved/resized rectangle for an existing area (minimap drag).
  const updateAreaRect = (id: string, rect: Pick<ScriptedArea, "x" | "y" | "w" | "h">) => {
    commit(areas.map((a) => (a.id === id ? { ...a, ...rect } : a)));
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
      maxWidth={480}
      eyebrow="Space editor"
      title="Floor map"
      subtitle="Drag on the map to draw a zone; drag a zone to move it, its corner to resize. Changes apply live."
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
      {/* Visual minimap — drag to draw / move / resize zones on the floor. */}
      <FloorZoneMap
        areas={areas}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={createAreaAt}
        onUpdate={updateAreaRect}
      />

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

// ── Visual floor minimap — draw / move / resize walk-in zones directly ────────

const MAP_W = 420;

type Rect = { x: number; y: number; w: number; h: number };
type DragState =
  | { mode: "draw"; start: { x: number; y: number }; rect: Rect }
  | { mode: "move" | "resize"; id: string; start: { x: number; y: number }; orig: Rect; rect: Rect };

/**
 * A scaled top-down map of the floor (its rooms) on which the operator paints
 * walk-in zones: drag on empty space to draw a new one, drag a zone to move it,
 * or drag its corner handle to resize. Commits the world-space rectangle back to
 * the editor (which persists via the area store) on pointer-up.
 */
function FloorZoneMap({
  areas,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
}: {
  areas: ScriptedArea[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (rect: Rect) => void;
  onUpdate: (id: string, rect: Rect) => void;
}) {
  const S = MAP_W / WORLD_W;
  const MAP_H = WORLD_H * S;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const toWorld = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toWorld(e);
    const sel = areas.find((a) => a.id === selectedId);
    // Resize handle of the selected zone?
    if (sel && Math.abs(p.x - (sel.x + sel.w)) < 12 / S && Math.abs(p.y - (sel.y + sel.h)) < 12 / S) {
      setDrag({ mode: "resize", id: sel.id, start: p, orig: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, rect: { x: sel.x, y: sel.y, w: sel.w, h: sel.h } });
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    // Topmost zone under the cursor → select + move.
    const hit = [...areas].reverse().find((a) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h);
    if (hit) {
      onSelect(hit.id);
      setDrag({ mode: "move", id: hit.id, start: p, orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } });
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    // Empty → draw a new zone.
    setDrag({ mode: "draw", start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
    ref.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toWorld(e);
    if (drag.mode === "draw") {
      setDrag({ ...drag, rect: { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) } });
    } else if (drag.mode === "move") {
      const x = clamp(drag.orig.x + (p.x - drag.start.x), 0, WORLD_W - drag.orig.w);
      const y = clamp(drag.orig.y + (p.y - drag.start.y), 0, WORLD_H - drag.orig.h);
      setDrag({ ...drag, rect: { x, y, w: drag.orig.w, h: drag.orig.h } });
    } else {
      const w = clamp(p.x - drag.orig.x, 24, WORLD_W - drag.orig.x);
      const h = clamp(p.y - drag.orig.y, 24, WORLD_H - drag.orig.y);
      setDrag({ ...drag, rect: { x: drag.orig.x, y: drag.orig.y, w, h } });
    }
  };

  const onPointerUp = () => {
    if (!drag) {
      return;
    }
    const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    if (drag.mode === "draw") {
      if (drag.rect.w > 16 && drag.rect.h > 16) onCreate(round(drag.rect));
    } else {
      onUpdate(drag.id, round(drag.rect));
    }
    setDrag(null);
  };

  return (
    <div className="space-y-1.5">
      <span className={labelCls}>Floor map — drag to draw a zone</span>
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative mx-auto select-none overflow-hidden rounded-md border"
        style={{ width: MAP_W, height: MAP_H, borderColor: "rgba(201,168,76,0.25)", background: "#0c0a07", touchAction: "none", cursor: "crosshair" }}
      >
        {ROOMS.map((r) => {
          const w = (r.colSpan ?? 1) * ROOM_W;
          return (
            <div
              key={r.key}
              className="absolute flex items-center justify-center"
              style={{ left: r.col * ROOM_W * S, top: r.row * ROOM_H * S, width: w * S, height: ROOM_H * S, border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="truncate px-1 text-[7.5px]" style={{ color: "rgba(255,255,255,0.24)", fontFamily: "Georgia, serif" }}>
                {r.label}
              </span>
            </div>
          );
        })}
        {areas.map((a) => {
          const live = drag && "id" in drag && drag.id === a.id ? drag.rect : a;
          const active = a.id === selectedId;
          const acc = a.accent ?? GOLD;
          return (
            <div
              key={a.id}
              className="absolute"
              style={{ left: live.x * S, top: live.y * S, width: live.w * S, height: live.h * S, background: `${acc}22`, border: `1.5px solid ${active ? acc : `${acc}88`}`, boxShadow: active ? `0 0 0 1px ${acc}55` : undefined }}
            >
              <span className="absolute left-1 top-0.5 max-w-[92%] truncate text-[7.5px]" style={{ color: acc }}>
                {a.label}
              </span>
              {active && (
                <span className="absolute" style={{ right: -4, bottom: -4, width: 9, height: 9, borderRadius: 2, background: acc, cursor: "nwse-resize" }} />
              )}
            </div>
          );
        })}
        {drag?.mode === "draw" && (
          <div
            className="absolute"
            style={{ left: drag.rect.x * S, top: drag.rect.y * S, width: drag.rect.w * S, height: drag.rect.h * S, border: `1.5px dashed ${GOLD}`, background: `${GOLD}18` }}
          />
        )}
      </div>
    </div>
  );
}
