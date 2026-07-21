// Interaction zones for the Virtual Office — WorkAdventure-style "special areas".
//
// Pure geometry/data (no DOM, no randomness), a third layout primitive alongside
// rooms (`layout.ts`) and objects (`furnish.ts`): given a room set, `defaultZones`
// derives the interactive rectangles that drive spatial behavior — where humans
// spawn, which rooms are quiet, where a meeting auto-starts, where an embedded
// whiteboard opens on the action key. Same rooms in, same zones out, so every
// client agrees without syncing, and the geometry stays unit-testable.
//
// COORDINATE CONTRACT (matches `layout.ts`): every zone rectangle is in TILE
// space (top-left origin) and lies inside its source room's bounds.
import {
  type OfficeRoom,
  type OfficeZone,
} from "./layout";

/** Round to 0.1-tile precision so zone rects are a serialization fixed point. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A zone rectangle clamped to lie fully inside `room`'s bounds. Guards against a
 * derived patch spilling past a wall regardless of the requested size.
 */
function rectIn(
  room: OfficeRoom,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(room.x, Math.min(x, room.x + room.w));
  const y0 = Math.max(room.y, Math.min(y, room.y + room.h));
  const x1 = Math.max(x0, Math.min(x + w, room.x + room.w));
  const y1 = Math.max(y0, Math.min(y + h, room.y + room.h));
  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

/** A zone spanning a room's whole interior rectangle. */
function wholeRoom(
  id: string,
  kind: OfficeZone["kind"],
  room: OfficeRoom,
  extra: Omit<OfficeZone, "id" | "kind" | "x" | "y" | "w" | "h"> = {},
): OfficeZone {
  return { id, kind, ...rectIn(room, room.x, room.y, room.w, room.h), ...extra };
}

/**
 * Derive the deterministic default interaction zones for a room layout:
 *
 *   • reception → a `spawn` zone over its lower area (where people arrive);
 *   • each pod   → a `silent` zone (whole room), "Focus — quiet zone";
 *   • lounge     → a `meeting` zone (whole room), "Meeting room", trigger "auto";
 *   • cafe       → a `social` zone (whole room);
 *   • one hub    → a small `embed` zone (a whiteboard patch), trigger "action",
 *                  opening an Excalidraw board, "Whiteboard — press to open".
 *
 * Pure and order-stable: same rooms in, same zones out, every rect inside its
 * room's bounds, every id unique.
 */
export function defaultZones(rooms: OfficeRoom[]): OfficeZone[] {
  const zones: OfficeZone[] = [];

  // The single hub that hosts the whiteboard embed: prefer "build", else the
  // first hub in layout order, so the choice is deterministic.
  const embedHub =
    rooms.find((r) => r.key === "build") ??
    rooms.find((r) => r.type === "hub") ??
    null;

  for (const room of rooms) {
    switch (room.type) {
      case "reception": {
        // Lower half of the lobby — the arrival apron, in front of the desk.
        const rect = rectIn(
          room,
          room.x,
          room.y + room.h / 2,
          room.w,
          room.h / 2,
        );
        zones.push({
          id: `zone-spawn-${room.key}`,
          kind: "spawn",
          ...rect,
          label: "Reception",
          trigger: "auto",
        });
        break;
      }
      case "pod":
        zones.push(
          wholeRoom(`zone-silent-${room.key}`, "silent", room, {
            label: "Focus — quiet zone",
            trigger: "auto",
          }),
        );
        break;
      case "lounge":
        zones.push(
          wholeRoom(`zone-meeting-${room.key}`, "meeting", room, {
            label: "Meeting room",
            trigger: "auto",
          }),
        );
        break;
      case "cafe":
        zones.push(
          wholeRoom(`zone-social-${room.key}`, "social", room, {
            label: "The Cafe",
            trigger: "auto",
          }),
        );
        break;
      default:
        break;
    }

    if (embedHub && room.key === embedHub.key) {
      // A small whiteboard patch near the top-center wall of the hub.
      const rect = rectIn(room, room.x + room.w / 2 - 1, room.y + 0.5, 2, 1);
      zones.push({
        id: `zone-embed-${room.key}`,
        kind: "embed",
        ...rect,
        label: "Whiteboard — press to open",
        trigger: "action",
        payload: { url: "https://excalidraw.com", policy: "clipboard-write" },
      });
    }
  }

  return zones;
}

/** Is a point inside a zone rectangle (inclusive of its edges)? */
function contains(pos: { x: number; y: number }, z: OfficeZone): boolean {
  return (
    pos.x >= z.x && pos.x <= z.x + z.w && pos.y >= z.y && pos.y <= z.y + z.h
  );
}

/**
 * The topmost zone containing `pos`, or null. Later zones in the array win, so a
 * more specific patch (e.g. the whiteboard embed) placed after a room-wide zone
 * takes precedence over it.
 */
export function zoneAt(
  pos: { x: number; y: number },
  zones: OfficeZone[],
): OfficeZone | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (contains(pos, zones[i])) return zones[i];
  }
  return null;
}

/** Every zone containing `pos`, in array (bottom-to-top) order. */
export function zonesContaining(
  pos: { x: number; y: number },
  zones: OfficeZone[],
): OfficeZone[] {
  return zones.filter((z) => contains(pos, z));
}

/** Stable key for a zone — its kind and top-left position. */
export function zoneKey(z: OfficeZone): string {
  return `${z.kind}@${round(z.x)},${round(z.y)}`;
}
