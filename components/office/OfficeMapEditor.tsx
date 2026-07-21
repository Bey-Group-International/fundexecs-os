"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  OFFICE_COLS,
  OFFICE_ROWS,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  TILE,
  type OfficeFloor,
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
  ROOM_TEMPLATES,
  addObject,
  addRoom,
  deleteRoom,
  duplicateRoom,
  hitTestRoom,
  moveRoom,
  objectLabel,
  removeObject,
  resizeHandleAt,
  resizeRoom,
  addFloor,
  deleteFloor,
  renameFloor,
  duplicateFloor,
  moveFloor,
  type ResizeHandle,
} from "@/lib/office/mapEditing";
import { saveOfficeLayout } from "@/app/(app)/office/actions";
import {
  listOfficeImages,
  uploadOfficeImage,
} from "@/app/(app)/office/asset-actions";

const CORE = new Set<string>(CORE_ROOM_KEYS);

/** The floors of a layout: the stored building, or a single ground floor. */
function floorsOf(layout: OfficeLayoutData): OfficeFloor[] {
  if (layout.floors && layout.floors.length > 0) return layout.floors;
  return [{ id: "ground", name: "Office Floor", level: 0, rooms: layout.rooms }];
}

/** A deep-ish clone so the working copy never mutates the incoming layout. */
function cloneFloors(floors: OfficeFloor[]): OfficeFloor[] {
  return floors.map((f) => ({ ...f, rooms: f.rooms.map((r) => ({ ...r })) }));
}

/** Assemble a full layout from the working floors (ground mirrored into rooms). */
function buildLayout(floors: OfficeFloor[], version: number): OfficeLayoutData {
  return { version, rooms: floors[0].rooms, floors };
}

/** Snap a tile-space value to the nearest half tile. */
function snap(v: number): number {
  return Math.round(v * 2) / 2;
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
 * Drag-on-canvas MapMaker for the persisted, multi-floor Virtual Office layout.
 * Floors are added, renamed, duplicated, reordered, and deleted; within a floor,
 * rooms are placed from a template palette, moved and resized by direct
 * manipulation, given a semantic type, and filled with furniture/branding props.
 * The ground floor's core rooms (the four hubs + Commons) are protected from
 * deletion and type-change. Save normalizes the whole building via
 * `serializeLayout` and persists through the server action, which re-checks
 * auth/org.
 */
export function OfficeMapEditor({
  initial,
  activeFloorId,
  onFloorChange,
  onSaved,
  onChange,
  orgId = "",
}: {
  initial: OfficeLayoutData;
  /** The floor the host is currently viewing (kept in sync both ways). */
  activeFloorId?: string;
  /** Called when the editor switches floor, so the host view can follow. */
  onFloorChange?: (id: string) => void;
  onSaved?: (d: OfficeLayoutData) => void;
  onChange?: (d: OfficeLayoutData) => void;
  /** Active org (defaults to ""; the server action resolves the session org). */
  orgId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // The whole building is the working copy; the active floor is what we edit.
  const [floors, setFloors] = useState<OfficeFloor[]>(() =>
    cloneFloors(floorsOf(initial)),
  );
  const [activeId, setActiveId] = useState<string>(
    activeFloorId && floors.some((f) => f.id === activeFloorId)
      ? activeFloorId
      : floors[0].id,
  );
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Follow the host's floor selection when it changes externally.
  useEffect(() => {
    if (activeFloorId && floors.some((f) => f.id === activeFloorId)) {
      setActiveId(activeFloorId);
    }
  }, [activeFloorId, floors]);

  // Keep the active floor valid if the building shrinks.
  useEffect(() => {
    if (!floors.some((f) => f.id === activeId)) setActiveId(floors[0].id);
  }, [floors, activeId]);

  const activeFloor = floors.find((f) => f.id === activeId) ?? floors[0];
  const rooms = activeFloor.rooms;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [paletteKind, setPaletteKind] = useState<OfficeObject["kind"] | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  const selected = rooms.find((r) => r.key === selectedKey) ?? null;

  /** Update the active floor's rooms (functional or replacement). */
  const setRooms = useCallback(
    (updater: OfficeRoom[] | ((prev: OfficeRoom[]) => OfficeRoom[])) => {
      setFloors((prev) =>
        prev.map((f) =>
          f.id === activeIdRef.current
            ? {
                ...f,
                rooms:
                  typeof updater === "function"
                    ? (updater as (p: OfficeRoom[]) => OfficeRoom[])(f.rooms)
                    : updater,
              }
            : f,
        ),
      );
    },
    [],
  );

  /** Switch the edited floor and let the host view follow. */
  const switchFloor = useCallback(
    (id: string) => {
      setActiveId(id);
      setSelectedKey(null);
      onFloorChange?.(id);
    },
    [onFloorChange],
  );

  // Load the org's previously-uploaded branding images for the picker.
  useEffect(() => {
    let active = true;
    void listOfficeImages(orgId).then((urls) => {
      if (active) setImages(urls);
    });
    return () => {
      active = false;
    };
  }, [orgId]);

  // ---- Custom image props ----------------------------------------------
  /** Drop a `kind:"image"` prop (with `src`) into the selected/first room. */
  const addImageToRoom = useCallback(
    (url: string, label?: string) => {
      setResult(null);
      setRooms((prev) => {
        const target = prev.find((r) => r.key === selectedKey) ?? prev[0];
        if (!target) return prev;
        const cx = target.x + target.w / 2;
        const cy = target.y + target.h / 2;
        const withObj = addObject(target, "image", cx, cy);
        const objs = withObj.objects ?? [];
        const created = objs[objs.length - 1];
        const patched: OfficeObject = {
          ...created,
          src: url,
          ...(label ? { label } : {}),
        };
        const nextRoom: OfficeRoom = {
          ...withObj,
          objects: [...objs.slice(0, -1), patched],
        };
        return prev.map((r) => (r.key === target.key ? nextRoom : r));
      });
      const target = rooms.find((r) => r.key === selectedKey) ?? rooms[0];
      if (target) setSelectedKey(target.key);
    },
    [rooms, selectedKey, setRooms],
  );

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });

  async function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setResult(null);
    setUploadBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const res = await uploadOfficeImage(orgId, dataUrl, file.name);
      if (res.url) {
        addImageToRoom(res.url, file.name);
        setImages((prev) => [res.url!, ...prev]);
      } else {
        setResult({ ok: false, error: res.error ?? "Upload failed" });
      }
    } catch {
      setResult({ ok: false, error: "Could not read the selected file" });
    } finally {
      setUploadBusy(false);
    }
  }

  // Surface live edits to the host (unserialized working copy of the building).
  useEffect(() => {
    onChange?.(buildLayout(floors, initial.version));
  }, [floors, initial.version, onChange]);

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

  // ---- Room mutations ---------------------------------------------------
  function addRoomFromTemplate(index: number) {
    const template = ROOM_TEMPLATES[index];
    if (!template) return;
    setResult(null);
    setRooms((prev) => addRoom(prev, template, { x: 2, y: 2 }));
  }

  function removeRoom(key: string) {
    if (CORE.has(key)) return;
    setResult(null);
    setRooms((prev) => deleteRoom(prev, key));
    setSelectedKey((k) => (k === key ? null : k));
  }

  function duplicateSelected(key: string) {
    setResult(null);
    setRooms((prev) => duplicateRoom(prev, key));
  }

  function deleteObject(roomKey: string, id: string) {
    setResult(null);
    setRooms((prev) =>
      prev.map((r) => (r.key === roomKey ? removeObject(r, id) : r)),
    );
  }

  // ---- Floor mutations --------------------------------------------------
  function onAddFloor() {
    setResult(null);
    setFloors((prev) => {
      const next = addFloor(prev);
      const created = next[next.length - 1];
      if (created) {
        setActiveId(created.id);
        onFloorChange?.(created.id);
      }
      return next;
    });
  }

  function onDeleteFloor(id: string) {
    setResult(null);
    setFloors((prev) => deleteFloor(prev, id));
  }

  function onDuplicateFloor(id: string) {
    setResult(null);
    setFloors((prev) => duplicateFloor(prev, id));
  }

  function onRenameFloor(id: string, name: string) {
    setFloors((prev) => renameFloor(prev, id, name));
  }

  function onMoveFloor(id: string, dir: "up" | "down") {
    setFloors((prev) => moveFloor(prev, id, dir));
  }

  function save() {
    setResult(null);
    const data = serializeLayout(buildLayout(floors, initial.version));
    startTransition(async () => {
      const res = await saveOfficeLayout("", data);
      setResult(res);
      if (res.ok) {
        setFloors(cloneFloors(data.floors ?? floorsOf(data)));
        onSaved?.(data);
      }
    });
  }

  const selectedCore = selected ? CORE.has(selected.key) : false;
  const orderedFloors = useMemo(
    () => [...floors].sort((a, b) => b.level - a.level),
    [floors],
  );

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg-primary">MapMaker</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Build the firm&apos;s building — add floors, place rooms from the
            palette, drag to move, grab a corner to resize, then Save. The ground
            floor&apos;s hub rooms and Commons are protected.
          </p>
        </div>
      </div>

      {/* Floors */}
      <div className="mt-4 rounded-lg border border-line bg-surface-2/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">
            Floors
          </span>
          <button
            type="button"
            onClick={onAddFloor}
            className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:bg-surface-2"
          >
            + Add floor
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {orderedFloors.map((f) => {
            const active = f.id === activeFloor.id;
            const idx = floors.findIndex((x) => x.id === f.id);
            return (
              <li
                key={f.id}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${
                  active
                    ? "border-gold-400/60 bg-gold-400/10"
                    : "border-line bg-surface-0"
                }`}
              >
                <button
                  type="button"
                  onClick={() => switchFloor(f.id)}
                  className="shrink-0 text-left"
                  aria-label={`Edit ${f.name}`}
                >
                  <span
                    className={`text-xs font-medium ${active ? "text-fg-primary" : "text-fg-secondary"}`}
                  >
                    L{f.level}
                  </span>
                </button>
                <input
                  aria-label={`Name for ${f.name}`}
                  value={f.name}
                  onChange={(e) => onRenameFloor(f.id, e.target.value)}
                  onFocus={() => switchFloor(f.id)}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-fg-secondary outline-none focus:border-line focus:bg-surface-0"
                />
                <button
                  type="button"
                  onClick={() => onMoveFloor(f.id, "up")}
                  disabled={idx === floors.length - 1}
                  className="px-1 text-xs text-fg-muted transition hover:text-fg-primary disabled:opacity-30"
                  aria-label="Move floor up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMoveFloor(f.id, "down")}
                  disabled={idx === 0}
                  className="px-1 text-xs text-fg-muted transition hover:text-fg-primary disabled:opacity-30"
                  aria-label="Move floor down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicateFloor(f.id)}
                  className="px-1 text-xs text-fg-muted transition hover:text-fg-primary"
                  aria-label="Duplicate floor"
                  title="Duplicate floor"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFloor(f.id)}
                  disabled={floors.length <= 1}
                  className="px-1 text-xs text-status-danger transition hover:opacity-80 disabled:opacity-30"
                  aria-label="Delete floor"
                  title="Delete floor"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-3 text-[11px] text-fg-muted">
        Editing <span className="text-fg-secondary">{activeFloor.name}</span>{" "}
        (level {activeFloor.level}) · {rooms.length} rooms
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
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
          {/* Room templates */}
          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-wide text-fg-muted">
              Add a room
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {ROOM_TEMPLATES.map((t, i) => (
                <button
                  key={`${t.type}-${t.label}`}
                  type="button"
                  onClick={() => addRoomFromTemplate(i)}
                  title={`Add a ${t.label} (${t.w}×${t.h})`}
                  className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-[11px] text-fg-secondary transition hover:bg-surface-2"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: t.accent }}
                    aria-hidden
                  />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Palette */}
          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-wide text-fg-muted">
              Furniture
            </span>
            <div className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
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

          {/* Custom branding images */}
          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-wide text-fg-muted">
              Custom image
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFilePicked}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadBusy}
              className="w-full rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadBusy ? "Uploading…" : "Upload image"}
            </button>
            <p className="mt-1 text-[10px] text-fg-muted">
              Logos, posters, or wall art — added to the selected room.
            </p>
            {images.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {images.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => addImageToRoom(url)}
                    title="Place this image in the selected room"
                    className="aspect-square overflow-hidden rounded-md border border-line transition hover:border-gold-400/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Uploaded branding"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
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

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => duplicateSelected(selected.key)}
                  className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2"
                >
                  Duplicate
                </button>
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
              Click a room to select it, or add one from a template above.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-xs text-status-success">Building saved.</span>
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
