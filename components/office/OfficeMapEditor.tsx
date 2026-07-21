"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  OFFICE_COLS,
  OFFICE_ROWS,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  TILE,
  type OfficeObject,
  type OfficeRoom,
  type RoomType,
} from "@/lib/office/layout";
import {
  CORE_ROOM_KEYS,
  serializeLayout,
  type OfficeLayoutData,
} from "@/lib/office/layoutStore";
import {
  OBJECT_CATALOG,
  ROOM_TYPES,
  addObject,
  hitTestRoom,
  moveRoom,
  objectLabel,
  removeObject,
  resizeHandleAt,
  resizeRoom,
  type ResizeHandle,
} from "@/lib/office/mapEditing";
import { saveOfficeLayout } from "@/app/(app)/office/actions";

const CORE = new Set<string>(CORE_ROOM_KEYS);

/** Snap a tile-space value to the nearest half tile. */
function snap(v: number): number {
  return Math.round(v * 2) / 2;
}

/** Mint a unique key for a newly added (non-core) room. */
function nextRoomKey(rooms: OfficeRoom[]): string {
  const used = new Set(rooms.map((r) => r.key));
  let i = rooms.length + 1;
  let key = `room-${i}`;
  while (used.has(key)) key = `room-${++i}`;
  return key;
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Read a theme CSS var (space-separated "r g b") into an rgb()/rgba() string. */
function cssColor(styles: CSSStyleDeclaration, name: string, alpha = 1): string {
  const v = styles.getPropertyValue(name).trim();
  if (!v) return alpha === 1 ? "#0a111f" : `rgba(10,17,31,${alpha})`;
  return alpha === 1 ? `rgb(${v})` : `rgb(${v} / ${alpha})`;
}

const EMOJI_BY_KIND: Record<OfficeObject["kind"], string> = Object.fromEntries(
  OBJECT_CATALOG.map((o) => [o.kind, o.emoji]),
) as Record<OfficeObject["kind"], string>;

interface DragState {
  mode: "move" | "resize";
  handle: ResizeHandle | null;
  startX: number;
  startY: number;
  original: OfficeRoom;
}

/**
 * Drag-on-canvas MapMaker for the persisted Virtual Office layout. Rooms are
 * moved and resized by direct manipulation (corner/edge grips), objects are
 * dropped from a palette into a room, and each room carries a semantic type.
 * Core rooms (the four hubs + Commons) are protected from deletion and
 * type-change. Save normalizes via `serializeLayout` and persists through the
 * server action, which re-checks auth/org.
 */
export function OfficeMapEditor({
  initial,
  onSaved,
  onChange,
}: {
  initial: OfficeLayoutData;
  onSaved?: (d: OfficeLayoutData) => void;
  onChange?: (d: OfficeLayoutData) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [rooms, setRooms] = useState<OfficeRoom[]>(() =>
    initial.rooms.map((r) => ({ ...r })),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [paletteKind, setPaletteKind] = useState<OfficeObject["kind"] | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(
    null,
  );

  const selected = rooms.find((r) => r.key === selectedKey) ?? null;

  // Surface live edits to the host (unserialized working copy).
  useEffect(() => {
    onChange?.({ version: initial.version, rooms });
  }, [rooms, initial.version, onChange]);

  // ---- Canvas rendering -------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const styles = getComputedStyle(canvas);

    const surface0 = cssColor(styles, "--fx-surface-0");
    const surface2 = cssColor(styles, "--fx-surface-2");
    const line = cssColor(styles, "--fx-line", 0.5);
    const fgMuted = cssColor(styles, "--fx-fg-muted");

    ctx.clearRect(0, 0, OFFICE_WIDTH, OFFICE_HEIGHT);
    ctx.fillStyle = surface0;
    ctx.fillRect(0, 0, OFFICE_WIDTH, OFFICE_HEIGHT);

    // Tile grid.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let c = 0; c <= OFFICE_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * TILE + 0.5, 0);
      ctx.lineTo(c * TILE + 0.5, OFFICE_HEIGHT);
      ctx.stroke();
    }
    for (let r = 0; r <= OFFICE_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * TILE + 0.5);
      ctx.lineTo(OFFICE_WIDTH, r * TILE + 0.5);
      ctx.stroke();
    }

    for (const room of rooms) {
      const x = room.x * TILE;
      const y = room.y * TILE;
      const w = room.w * TILE;
      const h = room.h * TILE;
      const isSel = room.key === selectedKey;

      ctx.fillStyle = hexA(room.accent, isSel ? 0.16 : 0.08);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = hexA(room.accent, isSel ? 0.95 : 0.5);
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.strokeRect(x, y, w, h);

      // Label + type tag.
      ctx.fillStyle = room.accent;
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(room.label.toUpperCase(), x + 8, y + 6);
      if (room.type) {
        ctx.fillStyle = fgMuted;
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText(room.type, x + 8, y + 22);
      }

      // Objects.
      for (const obj of room.objects ?? []) {
        const ox = obj.x * TILE;
        const oy = obj.y * TILE;
        ctx.fillStyle = hexA(room.accent, 0.22);
        ctx.beginPath();
        ctx.arc(ox, oy, TILE * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${Math.round(TILE * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(EMOJI_BY_KIND[obj.kind] ?? "?", ox, oy + 1);
      }

      // Resize grips for the selected room.
      if (isSel) {
        const corners: [number, number][] = [
          [x, y],
          [x + w, y],
          [x, y + h],
          [x + w, y + h],
        ];
        for (const [cx, cy] of corners) {
          ctx.fillStyle = surface2;
          ctx.strokeStyle = room.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(cx - 5, cy - 5, 10, 10);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }, [rooms, selectedKey]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ---- Pointer → tile-space helpers ------------------------------------
  function toTile(e: ReactPointerEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = OFFICE_WIDTH / rect.width;
    const scaleY = OFFICE_HEIGHT / rect.height;
    return {
      x: ((e.clientX - rect.left) * scaleX) / TILE,
      y: ((e.clientY - rect.top) * scaleY) / TILE,
    };
  }

  function patchRoom(key: string, patch: Partial<OfficeRoom>) {
    setResult(null);
    setRooms((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { x, y } = toTile(e);
    setResult(null);

    // Palette mode: drop an object into whatever room was clicked.
    if (paletteKind) {
      const room = hitTestRoom(rooms, x, y);
      if (room) {
        const next = addObject(room, paletteKind, x, y);
        setRooms((prev) => prev.map((r) => (r.key === room.key ? next : r)));
        setSelectedKey(room.key);
      }
      setPaletteKind(null);
      return;
    }

    // Resize the currently selected room if a grip is grabbed.
    if (selected) {
      const handle = resizeHandleAt(selected, x, y, 0.5);
      if (handle) {
        dragRef.current = {
          mode: "resize",
          handle,
          startX: x,
          startY: y,
          original: selected,
        };
        canvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Otherwise select + start moving the topmost room under the cursor.
    const room = hitTestRoom(rooms, x, y);
    setSelectedKey(room?.key ?? null);
    if (room) {
      dragRef.current = {
        mode: "move",
        handle: null,
        startX: x,
        startY: y,
        original: room,
      };
      canvasRef.current?.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toTile(e);
    const dx = snap(x - drag.startX);
    const dy = snap(y - drag.startY);
    const next =
      drag.mode === "move"
        ? moveRoom(drag.original, dx, dy)
        : resizeRoom(drag.original, drag.handle!, dx, dy);
    setRooms((prev) => prev.map((r) => (r.key === next.key ? next : r)));
  }

  function endDrag(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  // ---- Room list mutations ---------------------------------------------
  function addRoom() {
    setResult(null);
    setRooms((prev) => {
      const key = nextRoomKey(prev);
      const room: OfficeRoom = {
        key,
        label: "New Room",
        hub: null,
        x: 1,
        y: 1,
        w: 6,
        h: 5,
        accent: "#d4a82a",
        purpose: "",
        type: "focus",
      };
      return [...prev, room];
    });
  }

  function removeRoom(key: string) {
    if (CORE.has(key)) return;
    setResult(null);
    setRooms((prev) => prev.filter((r) => r.key !== key));
    setSelectedKey((k) => (k === key ? null : k));
  }

  function deleteObject(roomKey: string, id: string) {
    setResult(null);
    setRooms((prev) =>
      prev.map((r) => (r.key === roomKey ? removeObject(r, id) : r)),
    );
  }

  function save() {
    setResult(null);
    const data = serializeLayout({ version: initial.version, rooms });
    startTransition(async () => {
      const res = await saveOfficeLayout("", data);
      setResult(res);
      if (res.ok) {
        setRooms(data.rooms.map((r) => ({ ...r })));
        onSaved?.(data);
      }
    });
  }

  const selectedCore = selected ? CORE.has(selected.key) : false;

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg-primary">
            Map editor
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Drag rooms to move them, grab a corner to resize. Drop props from the
            palette, then Save. Hub rooms and Commons are protected.
          </p>
        </div>
        <button
          type="button"
          onClick={addRoom}
          className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
        >
          + Add room
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* Canvas */}
        <div className="overflow-x-auto rounded-lg border border-line bg-surface-0">
          <canvas
            ref={canvasRef}
            width={OFFICE_WIDTH}
            height={OFFICE_HEIGHT}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="block h-auto w-full touch-none select-none"
            style={{
              aspectRatio: `${OFFICE_WIDTH} / ${OFFICE_HEIGHT}`,
              cursor: paletteKind ? "copy" : "default",
            }}
          />
        </div>

        {/* Controls */}
        <div className="space-y-4">
          {/* Palette */}
          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-wide text-fg-muted">
              Palette
            </span>
            <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
              {OBJECT_CATALOG.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  onClick={() =>
                    setPaletteKind((k) => (k === o.kind ? null : o.kind))
                  }
                  title={`Place ${o.label}`}
                  className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] transition ${
                    paletteKind === o.kind
                      ? "border-gold-400 bg-gold-400/10 text-fg-primary"
                      : "border-line text-fg-secondary hover:bg-surface-2"
                  }`}
                >
                  <span className="text-base leading-none">{o.emoji}</span>
                  {o.label}
                </button>
              ))}
            </div>
            {paletteKind && (
              <p className="mt-1.5 text-[10px] text-gold-400">
                Click a room to place a{" "}
                {objectLabel(paletteKind).toLowerCase()}.
              </p>
            )}
          </div>

          {/* Selected room */}
          {selected ? (
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Color for ${selected.label}`}
                  type="color"
                  value={selected.accent}
                  onChange={(e) =>
                    patchRoom(selected.key, { accent: e.target.value })
                  }
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-line bg-surface-0 p-0.5"
                />
                <input
                  aria-label={`Name for ${selected.key}`}
                  value={selected.label}
                  onChange={(e) =>
                    patchRoom(selected.key, { label: e.target.value })
                  }
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-gold-400/60"
                />
              </div>

              <label className="mt-2.5 block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-fg-muted">
                  Type
                </span>
                <select
                  value={selected.type ?? "focus"}
                  disabled={selectedCore}
                  onChange={(e) =>
                    patchRoom(selected.key, {
                      type: e.target.value as RoomType,
                    })
                  }
                  className="w-full rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-secondary outline-none focus:border-gold-400/60 disabled:opacity-50"
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {selectedCore && (
                  <span className="mt-1 block text-[10px] text-fg-muted">
                    Core room — type locked.
                  </span>
                )}
              </label>

              {/* Objects in this room */}
              {selected.objects && selected.objects.length > 0 && (
                <div className="mt-2.5">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-fg-muted">
                    Objects
                  </span>
                  <ul className="space-y-1">
                    {selected.objects.map((obj) => (
                      <li
                        key={obj.id}
                        className="flex items-center justify-between gap-2 rounded border border-line bg-surface-0 px-2 py-1 text-xs text-fg-secondary"
                      >
                        <span>
                          {EMOJI_BY_KIND[obj.kind]} {objectLabel(obj.kind)}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteObject(selected.key, obj.id)}
                          className="rounded px-1.5 py-0.5 text-status-danger transition hover:bg-status-danger/10"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                {selectedCore ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                    Core
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeRoom(selected.key)}
                    className="rounded-md px-2 py-1 text-xs text-status-danger transition hover:bg-status-danger/10"
                  >
                    Delete room
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line bg-surface-2 p-3 text-xs text-fg-muted">
              Click a room to select it.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-xs text-status-success">Layout saved.</span>
        )}
        {result && !result.ok && (
          <span className="text-xs text-status-danger">
            {result.error ?? "Could not save layout."}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-gold-400 px-3.5 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
