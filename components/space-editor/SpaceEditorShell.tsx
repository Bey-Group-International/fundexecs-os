"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ROOMS, ROOM_W, ROOM_H, WORLD_W, WORLD_H } from "@/components/virtual-office/types";
import { PIECE_TYPES, PIECE_LABELS, type PieceType } from "@/lib/office/furnitureTypes";
import type { PlacedPiece } from "@/lib/office/furniturePlacement";
import {
  loadFurniturePlacements,
  saveFurniturePlacements,
  resetFurniturePlacements,
  nextPieceId,
} from "@/lib/office/furnitureStore";
import { FurniturePreview } from "@/components/virtual-office/program/FurniturePreview";
import { virtualOfficeRoutes } from "@/lib/virtualOfficeRoutes";

const GOLD = "#c9a84c";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The wide Marketplace hall is bespoke (drawn separately); room-relative coords
// don't map cleanly to it, so it's shown for context but not a placement target.
const EDIT_ROOMS = ROOMS.filter((r) => r.key !== "marketplace");
const EDIT_ROOM_KEYS = new Set(EDIT_ROOMS.map((r) => r.key));

type World = { x: number; y: number };

/** World point → the room it falls in + room-relative coords, or null. */
function worldToRoom(wx: number, wy: number): { roomKey: string; x: number; y: number } | null {
  for (const r of ROOMS) {
    if (!EDIT_ROOM_KEYS.has(r.key)) continue;
    const rx = r.col * ROOM_W;
    const ry = r.row * ROOM_H;
    const rw = (r.colSpan ?? 1) * ROOM_W;
    if (wx >= rx && wx < rx + rw && wy >= ry && wy < ry + ROOM_H) {
      return { roomKey: r.key, x: Math.round(wx - rx), y: Math.round(wy - ry) };
    }
  }
  return null;
}

/**
 * Space Editor — a full-page, multi-panel builder for the Virtual Office
 * environment. Top toolbar, a left panel that toggles between the asset palette
 * and the floor structure tree, a center placement canvas, a right inspector
 * for the selected object, and a bottom status bar. It reads and writes the
 * shared furniture-placement store, so edits appear on the live floor instantly
 * (and the in-world quick editor stays in sync).
 */
export function SpaceEditorShell() {
  const [pieces, setPieces] = useState<PlacedPiece[]>(() => loadFurniturePlacements());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<PieceType>("desk");
  const [leftTab, setLeftTab] = useState<"assets" | "structure">("assets");
  const [focusRoom, setFocusRoom] = useState<string | null>(null);
  const [dirtySince, setDirtySince] = useState(false);

  const selected = pieces.find((p) => p.id === selectedId) ?? null;

  const commit = (next: PlacedPiece[]) => {
    setPieces(next);
    saveFurniturePlacements(next); // validates + persists + emits the live-update event
    setDirtySince(true);
  };

  const placeAt = (world: World) => {
    const loc = worldToRoom(world.x, world.y);
    if (!loc) return;
    const id = nextPieceId(pieces);
    commit([...pieces, { id, roomKey: loc.roomKey, type: armed, x: loc.x, y: loc.y }]);
    setSelectedId(id);
  };

  const movePiece = (id: string, world: World) => {
    const loc = worldToRoom(world.x, world.y);
    if (!loc) return;
    commit(pieces.map((p) => (p.id === id ? { ...p, roomKey: loc.roomKey, x: loc.x, y: loc.y } : p)));
  };

  const updatePiece = (id: string, patch: Partial<Pick<PlacedPiece, "type" | "roomKey" | "x" | "y">>) => {
    commit(pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = pieces.filter((p) => p.id !== selected.id);
    commit(next);
    setSelectedId(next[0]?.id ?? null);
  };

  const resetAll = () => {
    setPieces(resetFurniturePlacements());
    setSelectedId(null);
    setDirtySince(true);
  };

  const roomCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pieces) m.set(p.roomKey, (m.get(p.roomKey) ?? 0) + 1);
    return m;
  }, [pieces]);

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-line/60 bg-[#0a0c11] text-slate-200">
      {/* Top toolbar */}
      <header className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Space editor</div>
          <div className="truncate text-[15px] font-semibold text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
            FundExecs Virtual Office
          </div>
        </div>
        <span
          className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
          style={{ background: "rgba(56,189,248,0.12)", color: "#7dd3fc" }}
        >
          Live draft
        </span>
        {dirtySince && (
          <span className="shrink-0 text-[10px] text-slate-500">Changes apply to the floor instantly</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={resetAll}
            className="rounded-md border px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:text-white"
            style={{ borderColor: "rgba(255,255,255,0.14)" }}
          >
            Clear placed
          </button>
          <Link
            href={virtualOfficeRoutes.root}
            className="rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-opacity"
            style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            Open office
          </Link>
        </div>
      </header>

      {/* Body: left panel · canvas · inspector */}
      <div className="flex min-h-0 flex-1">
        {/* Left — Assets / Structure */}
        <div className="flex w-[220px] shrink-0 flex-col border-r border-line/60">
          <div className="flex border-b border-line/60 text-[11px]">
            {(["assets", "structure"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setLeftTab(t)}
                className="flex-1 px-2 py-2 capitalize transition-colors"
                style={{
                  color: leftTab === t ? GOLD : "#8b95a3",
                  borderBottom: leftTab === t ? `2px solid ${GOLD}` : "2px solid transparent",
                  background: leftTab === t ? `${GOLD}0c` : "transparent",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {leftTab === "assets" ? (
              <div className="space-y-1.5">
                <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Furniture — pick, then click the floor</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {PIECE_TYPES.map((t) => {
                    const active = armed === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setArmed(t)}
                        className="flex flex-col items-center gap-1 rounded-md border px-1.5 pb-1 pt-1.5 transition-colors"
                        style={{
                          borderColor: active ? `${GOLD}80` : "rgba(255,255,255,0.08)",
                          background: active ? `${GOLD}14` : "rgba(255,255,255,0.02)",
                        }}
                      >
                        <FurniturePreview type={t} width={64} height={44} accent={active ? 0xc9a84c : 0x8fa2bd} />
                        <span className="w-full truncate text-center text-[10px]" style={{ color: active ? GOLD : "#cbd2dc" }}>
                          {PIECE_LABELS[t]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-slate-500">Virtual Office · Floor 1</p>
                {ROOMS.map((r) => {
                  const editable = EDIT_ROOM_KEYS.has(r.key);
                  const count = roomCounts.get(r.key) ?? 0;
                  const active = focusRoom === r.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      disabled={!editable}
                      onClick={() => setFocusRoom(active ? null : r.key)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40"
                      style={{ background: active ? `${GOLD}16` : "transparent", color: active ? GOLD : "#c2c9d4" }}
                    >
                      <span aria-hidden className="text-slate-600">
                        └
                      </span>
                      <span className="truncate">{r.label}</span>
                      {count > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-white/[0.06] px-1.5 text-[9px] text-slate-400">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Center — placement canvas */}
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-[#08090d] p-4">
          <PlacementCanvas
            pieces={pieces}
            selectedId={selectedId}
            armed={armed}
            focusRoom={focusRoom}
            onSelect={setSelectedId}
            onPlace={placeAt}
            onMove={movePiece}
          />
        </div>

        {/* Right — inspector */}
        <div className="w-[264px] shrink-0 overflow-y-auto border-l border-line/60 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">Inspector</p>
          {selected ? (
            <PieceInspector
              piece={selected}
              onChange={(patch) => updatePiece(selected.id, patch)}
              onRemove={removeSelected}
            />
          ) : (
            <p className="text-[11px] text-slate-500">
              Select a placed object to edit it, or pick a piece from Assets and click the floor to place one.
            </p>
          )}
        </div>
      </div>

      {/* Bottom status bar */}
      <footer className="flex items-center gap-4 border-t border-line/60 px-4 py-1.5 text-[10px] text-slate-500">
        <span>{pieces.length} placed object{pieces.length === 1 ? "" : "s"}</span>
        <span>Arming: {PIECE_LABELS[armed]}</span>
        {selected && (
          <span>
            Selected: {PIECE_LABELS[selected.type]} · {selected.roomKey} ({selected.x}, {selected.y})
          </span>
        )}
        <span className="ml-auto">Decorative — objects don&apos;t block movement</span>
      </footer>
    </div>
  );
}

// ── Center canvas — click to place, drag to move ──────────────────────────────

const CANVAS_W = 560;

function PlacementCanvas({
  pieces,
  selectedId,
  armed,
  focusRoom,
  onSelect,
  onPlace,
  onMove,
}: {
  pieces: PlacedPiece[];
  selectedId: string | null;
  armed: PieceType;
  focusRoom: string | null;
  onSelect: (id: string) => void;
  onPlace: (world: World) => void;
  onMove: (id: string, world: World) => void;
}) {
  const S = CANVAS_W / WORLD_W;
  const CANVAS_H = WORLD_H * S;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; live: World } | null>(null);

  const toWorld = (e: React.PointerEvent): World => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
  };
  const pieceWorld = (p: PlacedPiece): World | null => {
    const room = ROOMS.find((r) => r.key === p.roomKey);
    return room ? { x: room.col * ROOM_W + p.x, y: room.row * ROOM_H + p.y } : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    const hit = [...pieces].reverse().find((p) => {
      const pw = pieceWorld(p);
      return pw && Math.hypot(pw.x - w.x, pw.y - w.y) < 14;
    });
    if (hit) {
      onSelect(hit.id);
      setDrag({ id: hit.id, live: pieceWorld(hit)! });
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    onPlace(w);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, live: toWorld(e) });
  };
  const onPointerUp = () => {
    if (!drag) return;
    onMove(drag.id, drag.live);
    setDrag(null);
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative select-none overflow-hidden rounded-lg border shadow-2xl"
      style={{ width: CANVAS_W, height: CANVAS_H, borderColor: "rgba(201,168,76,0.25)", background: "#0c0a07", touchAction: "none", cursor: "crosshair" }}
    >
      {ROOMS.map((r) => {
        const w = (r.colSpan ?? 1) * ROOM_W;
        const editable = EDIT_ROOM_KEYS.has(r.key);
        const focused = focusRoom === r.key;
        return (
          <div
            key={r.key}
            className="absolute flex items-start justify-start"
            style={{
              left: r.col * ROOM_W * S,
              top: r.row * ROOM_H * S,
              width: w * S,
              height: ROOM_H * S,
              border: focused ? `1px solid ${GOLD}88` : "1px solid rgba(255,255,255,0.06)",
              background: focused ? `${GOLD}0c` : editable ? "transparent" : "rgba(255,255,255,0.03)",
            }}
          >
            <span className="truncate px-1 pt-0.5 text-[8px]" style={{ color: "rgba(255,255,255,0.28)", fontFamily: "Georgia, serif" }}>
              {r.label}
            </span>
          </div>
        );
      })}
      {pieces.map((p) => {
        const pw = drag && drag.id === p.id ? drag.live : pieceWorld(p);
        if (!pw) return null;
        const active = p.id === selectedId;
        const sz = active ? 11 : 8;
        return (
          <span
            key={p.id}
            title={`${PIECE_LABELS[p.type]} · ${p.roomKey}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-sm"
            style={{
              left: pw.x * S,
              top: pw.y * S,
              width: sz,
              height: sz,
              background: GOLD,
              border: "1px solid rgba(0,0,0,0.55)",
              boxShadow: active ? `0 0 0 2px ${GOLD}66` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Right inspector — selected object properties ──────────────────────────────

const fieldCls =
  "w-full rounded border bg-transparent px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-[#c9a84c80]";
const fieldStyle = { borderColor: "rgba(255,255,255,0.12)" } as const;
const labelCls = "mb-0.5 block text-[9px] uppercase tracking-[0.16em] text-slate-500";

function PieceInspector({
  piece,
  onChange,
  onRemove,
}: {
  piece: PlacedPiece;
  onChange: (patch: Partial<Pick<PlacedPiece, "type" | "roomKey" | "x" | "y">>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 rounded" style={{ background: "#0c0a07", border: "1px solid rgba(255,255,255,0.06)" }}>
          <FurniturePreview type={piece.type} width={64} height={48} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
            {PIECE_LABELS[piece.type]}
          </div>
          <div className="text-[10px] text-slate-500">id {piece.id}</div>
        </div>
      </div>

      <label className="block">
        <span className={labelCls}>Type</span>
        <select className={fieldCls} style={fieldStyle} value={piece.type} onChange={(e) => onChange({ type: e.target.value as PieceType })}>
          {PIECE_TYPES.map((t) => (
            <option key={t} value={t} style={{ background: "#12100c" }}>
              {PIECE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelCls}>Room</span>
        <select className={fieldCls} style={fieldStyle} value={piece.roomKey} onChange={(e) => onChange({ roomKey: e.target.value })}>
          {EDIT_ROOMS.map((r) => (
            <option key={r.key} value={r.key} style={{ background: "#12100c" }}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={labelCls}>X (0–{ROOM_W})</span>
          <input
            type="number"
            className={fieldCls}
            style={fieldStyle}
            min={0}
            max={ROOM_W}
            value={piece.x}
            onChange={(e) => onChange({ x: clamp(Math.round(Number(e.target.value) || 0), 0, ROOM_W) })}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Y (0–{ROOM_H})</span>
          <input
            type="number"
            className={fieldCls}
            style={fieldStyle}
            min={0}
            max={ROOM_H}
            value={piece.y}
            onChange={(e) => onChange({ y: clamp(Math.round(Number(e.target.value) || 0), 0, ROOM_H) })}
          />
        </label>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onRemove}
          className="rounded border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors hover:bg-[#ef444414]"
          style={{ borderColor: "#ef444455", color: "#ef4444" }}
        >
          Remove object
        </button>
      </div>
    </div>
  );
}
