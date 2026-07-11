"use client";

import { useRef, useState } from "react";
import { FloorOverlay } from "./FloorOverlay";
import { FurniturePreview } from "./FurniturePreview";
import { ROOMS, ROOM_W, ROOM_H, WORLD_W, WORLD_H } from "@/components/virtual-office/types";
import { PIECE_TYPES, PIECE_LABELS, type PieceType } from "@/lib/office/furnitureTypes";
import type { PlacedPiece } from "@/lib/office/furniturePlacement";
import {
  loadFurniturePlacements,
  saveFurniturePlacements,
  resetFurniturePlacements,
  nextPieceId,
} from "@/lib/office/furnitureStore";

const GOLD = "#c9a84c";
const labelCls = "mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500";

// Rooms an operator can place into. The wide Marketplace hall is bespoke
// (drawn separately) and room-relative coords don't map cleanly to it, so it's
// excluded from placement for now (shown on the map for context only).
const EDIT_ROOMS = ROOMS.filter((r) => r.key !== "marketplace");
const EDIT_ROOM_KEYS = new Set(EDIT_ROOMS.map((r) => r.key));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
 * Space editor — furniture. Pick a piece from the palette, click the floor map
 * to drop it, drag a placed piece to move it, select one to remove it. Every
 * change persists via the furniture store, which emits an event the Phaser
 * scene reacts to — so pieces appear on the live floor instantly.
 */
export function FurnitureEditor({ onClose }: { onClose: () => void }) {
  const [pieces, setPieces] = useState<PlacedPiece[]>(() => loadFurniturePlacements());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<PieceType>("desk");

  const selected = pieces.find((p) => p.id === selectedId) ?? null;

  const commit = (next: PlacedPiece[]) => {
    setPieces(next);
    saveFurniturePlacements(next); // validates + persists + emits the live-update event
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

  /** Patch a single field on a placed piece (type / room / x / y). */
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
    const defaults = resetFurniturePlacements();
    setPieces(defaults);
    setSelectedId(null);
  };

  return (
    <FloorOverlay
      accent={GOLD}
      onClose={onClose}
      ariaLabel="Space editor — furniture"
      maxWidth={480}
      eyebrow="Space editor"
      title="Furniture"
      subtitle="Pick a piece, then click the floor to place it; drag a piece to move it. Furniture is decorative — it won't block movement. Changes apply live."
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={resetAll}
            className="rounded border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            Clear placed furniture
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
      {/* Palette — pick the piece to place (rendered exactly as it draws on the floor) */}
      <div className="space-y-1.5">
        <span className={labelCls}>Palette — pick a piece</span>
        <div className="grid grid-cols-3 gap-1.5">
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
                <FurniturePreview type={t} width={58} height={40} accent={active ? 0xc9a84c : 0x8fa2bd} />
                <span
                  className="w-full truncate text-center text-[10px]"
                  style={{ color: active ? GOLD : "#cbd2dc" }}
                >
                  {PIECE_LABELS[t]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Floor placement map */}
      <FloorPlacementMap
        pieces={pieces}
        selectedId={selectedId}
        armed={armed}
        onSelect={setSelectedId}
        onPlace={placeAt}
        onMove={movePiece}
      />

      {/* Property editor — fine-tune the selected piece */}
      {selected && (
        <PiecePropertyEditor
          piece={selected}
          onChange={(patch) => updatePiece(selected.id, patch)}
          onRemove={removeSelected}
        />
      )}

      {/* Placed list */}
      <div className="space-y-1.5">
        <span className={labelCls}>Placed furniture ({pieces.length})</span>
        {pieces.length === 0 && (
          <p className="text-[11px] text-slate-500">None yet — pick a piece above and click the floor to place it.</p>
        )}
        <div className="space-y-1">
          {pieces.map((p) => {
            const active = p.id === selectedId;
            const room = ROOMS.find((r) => r.key === p.roomKey);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className="flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors"
                style={{
                  borderColor: active ? `${GOLD}80` : "rgba(255,255,255,0.08)",
                  background: active ? `${GOLD}14` : "rgba(255,255,255,0.02)",
                }}
              >
                <span className="shrink-0" style={{ opacity: 0.9 }}>
                  <FurniturePreview type={p.type} width={34} height={26} accent={active ? 0xc9a84c : 0x8fa2bd} />
                </span>
                <span className="truncate text-[12px] text-slate-100">{PIECE_LABELS[p.type]}</span>
                <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-slate-500">{room?.label ?? p.roomKey}</span>
              </button>
            );
          })}
        </div>
      </div>
    </FloorOverlay>
  );
}

// ── Per-piece property editor ─────────────────────────────────────────────────

const fieldCls =
  "w-full rounded border bg-transparent px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-[#c9a84c80]";
const fieldStyle = { borderColor: "rgba(255,255,255,0.12)" } as const;

/**
 * Fine-tune a placed piece: swap its type, move it to another room, or nudge
 * its exact room-relative x/y. Every edit commits through the store, so the
 * live floor and the minimap update together.
 */
function PiecePropertyEditor({
  piece,
  onChange,
  onRemove,
}: {
  piece: PlacedPiece;
  onChange: (patch: Partial<Pick<PlacedPiece, "type" | "roomKey" | "x" | "y">>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="space-y-2 rounded-md border p-2.5"
      style={{ borderColor: `${GOLD}33`, background: "rgba(201,168,76,0.05)" }}
    >
      <div className="flex items-center justify-between">
        <span className={labelCls} style={{ marginBottom: 0 }}>
          Selected piece
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded border px-2 py-0.5 text-[9px] uppercase tracking-wider transition-colors hover:bg-[#ef444414]"
          style={{ borderColor: "#ef444455", color: "#ef4444" }}
        >
          Remove
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <span
          className="shrink-0 rounded"
          style={{ background: "#0c0a07", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <FurniturePreview type={piece.type} width={66} height={48} />
        </span>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className={labelCls}>Type</span>
            <select
              className={fieldCls}
              style={fieldStyle}
              value={piece.type}
              onChange={(e) => onChange({ type: e.target.value as PieceType })}
            >
              {PIECE_TYPES.map((t) => (
                <option key={t} value={t} style={{ background: "#12100c" }}>
                  {PIECE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className={labelCls}>Room</span>
            <select
              className={fieldCls}
              style={fieldStyle}
              value={piece.roomKey}
              onChange={(e) => onChange({ roomKey: e.target.value })}
            >
              {EDIT_ROOMS.map((r) => (
                <option key={r.key} value={r.key} style={{ background: "#12100c" }}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
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
      </div>
    </div>
  );
}

// ── Visual floor minimap — click to place, drag to move ───────────────────────

const MAP_W = 420;

function FloorPlacementMap({
  pieces,
  selectedId,
  armed,
  onSelect,
  onPlace,
  onMove,
}: {
  pieces: PlacedPiece[];
  selectedId: string | null;
  armed: PieceType;
  onSelect: (id: string) => void;
  onPlace: (world: World) => void;
  onMove: (id: string, world: World) => void;
}) {
  const S = MAP_W / WORLD_W;
  const MAP_H = WORLD_H * S;
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
    // Grab the topmost placed piece under the cursor → select + move.
    const hit = [...pieces].reverse().find((p) => {
      const pw = pieceWorld(p);
      return pw && Math.hypot(pw.x - w.x, pw.y - w.y) < 12;
    });
    if (hit) {
      onSelect(hit.id);
      setDrag({ id: hit.id, live: pieceWorld(hit)! });
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    // Empty spot → drop a new piece of the armed type.
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
    <div className="space-y-1.5">
      <span className={labelCls}>
        Floor map — click to place “{PIECE_LABELS[armed]}”, drag a piece to move
      </span>
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative mx-auto select-none overflow-hidden rounded-md border"
        style={{
          width: MAP_W,
          height: MAP_H,
          borderColor: "rgba(201,168,76,0.25)",
          background: "#0c0a07",
          touchAction: "none",
          cursor: "crosshair",
        }}
      >
        {ROOMS.map((r) => {
          const w = (r.colSpan ?? 1) * ROOM_W;
          const editable = EDIT_ROOM_KEYS.has(r.key);
          return (
            <div
              key={r.key}
              className="absolute flex items-center justify-center"
              style={{
                left: r.col * ROOM_W * S,
                top: r.row * ROOM_H * S,
                width: w * S,
                height: ROOM_H * S,
                border: "1px solid rgba(255,255,255,0.06)",
                background: editable ? "transparent" : "rgba(255,255,255,0.03)",
              }}
            >
              <span className="truncate px-1 text-[7.5px]" style={{ color: "rgba(255,255,255,0.24)", fontFamily: "Georgia, serif" }}>
                {r.label}
              </span>
            </div>
          );
        })}
        {pieces.map((p) => {
          const pw = drag && drag.id === p.id ? drag.live : pieceWorld(p);
          if (!pw) return null;
          const active = p.id === selectedId;
          const sz = active ? 9 : 7;
          return (
            <span
              key={p.id}
              title={PIECE_LABELS[p.type]}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-sm"
              style={{
                left: pw.x * S,
                top: pw.y * S,
                width: sz,
                height: sz,
                background: GOLD,
                border: "1px solid rgba(0,0,0,0.55)",
                boxShadow: active ? `0 0 0 2px ${GOLD}55` : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
