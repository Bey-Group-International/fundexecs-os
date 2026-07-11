"use client";

import { useRef, useState } from "react";
import { FloorOverlay } from "./FloorOverlay";
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
const EDIT_ROOM_KEYS = new Set(ROOMS.filter((r) => r.key !== "marketplace").map((r) => r.key));

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
      {/* Palette — pick the piece to place */}
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
                className="truncate rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors"
                style={{
                  borderColor: active ? `${GOLD}80` : "rgba(255,255,255,0.08)",
                  background: active ? `${GOLD}14` : "rgba(255,255,255,0.02)",
                  color: active ? GOLD : "#cbd2dc",
                }}
              >
                {PIECE_LABELS[t]}
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
                className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors"
                style={{
                  borderColor: active ? `${GOLD}80` : "rgba(255,255,255,0.08)",
                  background: active ? `${GOLD}14` : "rgba(255,255,255,0.02)",
                }}
              >
                <span className="truncate text-[12px] text-slate-100">{PIECE_LABELS[p.type]}</span>
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-500">{room?.label ?? p.roomKey}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={removeSelected}
            className="rounded border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors"
            style={{ borderColor: "#ef444455", color: "#ef4444" }}
          >
            Remove piece
          </button>
        </div>
      )}
    </FloorOverlay>
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
