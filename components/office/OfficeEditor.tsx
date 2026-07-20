"use client";

import { useMemo, useState, useTransition } from "react";
import {
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeRoom,
} from "@/lib/office/layout";
import {
  CORE_ROOM_KEYS,
  serializeLayout,
  type OfficeLayoutData,
} from "@/lib/office/layoutStore";
import { saveOfficeLayout } from "@/app/(app)/office/actions";

const CORE = new Set<string>(CORE_ROOM_KEYS);
const MIN_SIZE = 2;

/** Clamp a single rect field to the floor as the operator types. */
function clampField(
  field: "x" | "y" | "w" | "h",
  value: number,
  room: OfficeRoom,
): number {
  if (!Number.isFinite(value)) value = 0;
  if (field === "w") return Math.min(Math.max(value, MIN_SIZE), OFFICE_COLS - room.x);
  if (field === "h") return Math.min(Math.max(value, MIN_SIZE), OFFICE_ROWS - room.y);
  if (field === "x") return Math.min(Math.max(value, 0), OFFICE_COLS - room.w);
  return Math.min(Math.max(value, 0), OFFICE_ROWS - room.h);
}

/** Mint a unique key for a newly added (non-core) room. */
function nextRoomKey(rooms: OfficeRoom[]): string {
  const used = new Set(rooms.map((r) => r.key));
  let i = rooms.length + 1;
  let key = `room-${i}`;
  while (used.has(key)) key = `room-${++i}`;
  return key;
}

// The MapMaker-style editor for a persisted office layout. A plain form/list —
// rename rooms, nudge each room's x/y/w/h and accent, add/remove custom rooms —
// with the four hub rooms + Commons protected from deletion (the renderer and
// presence logic depend on them). Save serializes and persists via the server
// action, which re-validates and re-checks org membership.
export function OfficeEditor({
  initial,
  onSaved,
}: {
  initial: OfficeLayoutData;
  onSaved?: (d: OfficeLayoutData) => void;
}) {
  const [rooms, setRooms] = useState<OfficeRoom[]>(() =>
    initial.rooms.map((r) => ({ ...r })),
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(
    null,
  );

  const dirty = useMemo(
    () => JSON.stringify(rooms) !== JSON.stringify(initial.rooms),
    [rooms, initial.rooms],
  );

  function patchRoom(key: string, patch: Partial<OfficeRoom>) {
    setResult(null);
    setRooms((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function patchRect(key: string, field: "x" | "y" | "w" | "h", raw: string) {
    setRooms((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, [field]: clampField(field, Number(raw), r) } : r,
      ),
    );
    setResult(null);
  }

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
      };
      return [...prev, room];
    });
  }

  function removeRoom(key: string) {
    if (CORE.has(key)) return;
    setResult(null);
    setRooms((prev) => prev.filter((r) => r.key !== key));
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

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg-primary">Office layout</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Rename rooms, adjust their position and size, or add your own. The
            hub rooms and Commons are fixed.
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

      <ul className="mt-4 space-y-3">
        {rooms.map((room) => {
          const core = CORE.has(room.key);
          return (
            <li
              key={room.key}
              className="rounded-lg border border-line bg-surface-2 p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Color for ${room.label}`}
                  type="color"
                  value={room.accent}
                  onChange={(e) => patchRoom(room.key, { accent: e.target.value })}
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-line bg-surface-0 p-0.5"
                />
                <input
                  aria-label={`Name for ${room.key}`}
                  value={room.label}
                  onChange={(e) => patchRoom(room.key, { label: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-gold-400/60"
                />
                {core ? (
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                    Core
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeRoom(room.key)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-status-danger transition hover:bg-status-danger/10"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="mt-2 grid grid-cols-4 gap-2">
                {(["x", "y", "w", "h"] as const).map((field) => (
                  <label key={field} className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-fg-muted">
                      {field}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={room[field]}
                      min={field === "w" || field === "h" ? MIN_SIZE : 0}
                      max={field === "x" || field === "w" ? OFFICE_COLS : OFFICE_ROWS}
                      onChange={(e) => patchRect(room.key, field, e.target.value)}
                      className="w-full rounded-md border border-line bg-surface-0 px-2 py-1 text-sm text-fg-secondary outline-none focus:border-gold-400/60"
                    />
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

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
          disabled={pending || !dirty}
          className="rounded-md bg-gold-400 px-3.5 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
