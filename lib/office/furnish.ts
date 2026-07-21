// Deterministic auto-furnishing for the Virtual Office.
//
// Pure geometry/data (no DOM, no randomness): given a room, `furnishRoom`
// returns a template of {@link OfficeObject}s laid out for that room's `type` —
// workstations for hubs, soft seating for lounges, a counter for the cafe, and
// so on. Same room in, same objects out, so every client furnishes identically
// and the built-in `DEFAULT_LAYOUT` can ship pre-furnished. Every object sits
// inside the room rectangle with a unique id, ready to survive `layoutStore`
// validation unchanged.
import {
  type OfficeObject,
  type OfficeObjectKind,
  type OfficeRoom,
} from "./layout";

/** Default footprint (tiles) for each prop kind — shared with the map editor. */
export const PROP_SIZE: Record<OfficeObjectKind, { w: number; h: number }> = {
  // legacy
  desk: { w: 2, h: 1 },
  plant: { w: 1, h: 1 },
  whiteboard: { w: 2, h: 0.5 },
  couch: { w: 3, h: 1 },
  table: { w: 2, h: 2 },
  screen: { w: 1.5, h: 0.5 },
  // premium catalogue
  chair: { w: 1, h: 1 },
  monitor: { w: 1, h: 0.5 },
  plant_lg: { w: 1.5, h: 1.5 },
  armchair: { w: 1.5, h: 1.5 },
  coffee_table: { w: 2, h: 1.5 },
  meeting_table: { w: 4, h: 2 },
  tv: { w: 2, h: 0.5 },
  bookshelf: { w: 2, h: 0.5 },
  rug: { w: 4, h: 3 },
  rug_round: { w: 3, h: 3 },
  reception_desk: { w: 4, h: 1.5 },
  cafe_counter: { w: 4, h: 1.5 },
  coffee_machine: { w: 1, h: 1 },
  water_cooler: { w: 1, h: 1 },
  wall_art: { w: 1.5, h: 0.5 },
  window: { w: 2, h: 0.5 },
  divider: { w: 0.5, h: 3 },
  pod: { w: 3, h: 3 },
  lamp: { w: 1, h: 1 },
  server_rack: { w: 1.5, h: 1.5 },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Round to 0.1-tile precision so furnished coords are a serialization fixed point. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Linear interpolation, guarding the single-step (`steps <= 1`) case. */
function lerp(a: number, b: number, i: number, steps: number): number {
  return steps <= 1 ? (a + b) / 2 : a + ((b - a) * i) / (steps - 1);
}

/**
 * A per-room object builder: mints unique, kind-indexed ids and clamps every
 * anchor a half-tile inside the room so props never poke through a wall.
 */
function builder(room: OfficeRoom) {
  const out: OfficeObject[] = [];
  const counts: Partial<Record<OfficeObjectKind, number>> = {};
  const minX = room.x + 0.5;
  const maxX = room.x + room.w - 0.5;
  const minY = room.y + 0.5;
  const maxY = room.y + room.h - 0.5;

  function add(kind: OfficeObjectKind, x: number, y: number, rot?: number): void {
    const n = (counts[kind] = (counts[kind] ?? 0) + 1);
    const size = PROP_SIZE[kind];
    const obj: OfficeObject = {
      id: `${room.key}-${kind}-${n}`,
      kind,
      x: round(clamp(x, minX, maxX)),
      y: round(clamp(y, minY, maxY)),
      w: size.w,
      h: size.h,
    };
    if (rot) obj.rot = rot;
    out.push(obj);
  }

  return { out, add };
}

/** Hub: rows of workstations (desk + monitor + chair) plus a plant and shelf. */
function furnishHub(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  const cols = Math.max(1, Math.min(3, Math.floor((room.w - 3) / 3)));
  const rows = Math.max(1, Math.min(2, Math.floor((room.h - 4) / 3)));
  const x0 = room.x + 2.5;
  const x1 = room.x + room.w - 2.5;
  const y0 = room.y + 3;
  const y1 = room.y + room.h - 2.5;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = lerp(x0, x1, c, cols);
      const cy = lerp(y0, y1, r, rows);
      add("desk", cx, cy);
      add("monitor", cx, cy - 0.7);
      add("chair", cx, cy + 0.9);
    }
  }
  add("bookshelf", room.x + room.w / 2, room.y + 0.8);
  add("plant_lg", room.x + 1.2, room.y + room.h - 1.2);
  return out;
}

/** Meeting: a centered table ringed with chairs, plus a TV and whiteboard. */
function furnishMeeting(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  add("meeting_table", cx, cy);
  add("chair", cx - 2.2, cy - 0.6);
  add("chair", cx - 2.2, cy + 0.6);
  add("chair", cx + 2.2, cy - 0.6);
  add("chair", cx + 2.2, cy + 0.6);
  add("chair", cx, cy - 1.6);
  add("chair", cx, cy + 1.6);
  add("tv", cx, room.y + 0.6);
  add("whiteboard", room.x + 1.2, cy, 90);
  return out;
}

/** Lounge / social: a rug, soft seating around a coffee table, and greenery. */
function furnishLounge(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  add("rug_round", cx, cy);
  add("coffee_table", cx, cy);
  add("couch", cx, cy - 1.6);
  add("armchair", cx - 2.6, cy + 0.6);
  add("armchair", cx + 2.6, cy + 0.6);
  add("plant_lg", room.x + 1.2, room.y + 1.2);
  add("plant_lg", room.x + room.w - 1.2, room.y + room.h - 1.2);
  return out;
}

/** Cafe: a service counter with a coffee machine and a row of bistro tables. */
function furnishCafe(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  add("cafe_counter", room.x + room.w / 2, room.y + 1);
  add("coffee_machine", room.x + room.w - 1.5, room.y + 1);
  add("plant_lg", room.x + 1.2, room.y + 1);
  const tables = Math.max(1, Math.min(4, Math.floor((room.w - 2) / 3)));
  const ty = room.y + room.h - 1.4;
  for (let i = 0; i < tables; i++) {
    const tx = lerp(room.x + 2.5, room.x + room.w - 2.5, i, tables);
    add("table", tx, ty);
    add("chair", tx - 1, ty);
    add("chair", tx + 1, ty);
  }
  return out;
}

/** Reception: a welcome desk, waiting couch, framed art, and flanking plants. */
function furnishReception(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  const cx = room.x + room.w / 2;
  add("reception_desk", cx, room.y + 2);
  add("wall_art", cx, room.y + 0.6);
  add("couch", cx, room.y + room.h - 2);
  add("plant_lg", room.x + 1.4, room.y + 1.4);
  add("plant_lg", room.x + room.w - 1.4, room.y + 1.4);
  return out;
}

/** Pod: a single focus booth with a desk and a small plant. */
function furnishPod(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  add("pod", cx, cy);
  add("desk", cx, cy - 0.2);
  add("chair", cx, cy + 0.9);
  add("plant", room.x + room.w - 1, room.y + 1);
  return out;
}

/** Commons: a large rug, greenery in every corner, and bench seating. */
function furnishCommons(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  add("rug", cx, cy);
  add("plant_lg", room.x + 1.4, room.y + 1.4);
  add("plant_lg", room.x + room.w - 1.4, room.y + 1.4);
  add("plant_lg", room.x + 1.4, room.y + room.h - 1.4);
  add("plant_lg", room.x + room.w - 1.4, room.y + room.h - 1.4);
  add("couch", cx - 3, cy);
  add("couch", cx + 3, cy);
  return out;
}

/** Fallback (focus / private / untyped): a plant and a small desk. */
function furnishDefault(room: OfficeRoom): OfficeObject[] {
  const { out, add } = builder(room);
  add("desk", room.x + room.w / 2, room.y + room.h / 2);
  add("plant_lg", room.x + 1.2, room.y + 1.2);
  return out;
}

/**
 * Auto-furnish a room from a deterministic template chosen by its `type`. Pure:
 * same room in, same objects out, all inside the room bounds with unique ids.
 */
export function furnishRoom(room: OfficeRoom): OfficeObject[] {
  switch (room.type) {
    case "hub":
      return furnishHub(room);
    case "meeting":
      return furnishMeeting(room);
    case "lounge":
    case "social":
      return furnishLounge(room);
    case "cafe":
      return furnishCafe(room);
    case "reception":
      return furnishReception(room);
    case "pod":
      return furnishPod(room);
    case "commons":
      return furnishCommons(room);
    default:
      return furnishDefault(room);
  }
}

/**
 * Furnish every room, returning fresh room objects with an `objects` array. A
 * room whose template yields nothing keeps no `objects` key (byte-compatible
 * with object-free legacy layouts).
 */
export function furnishAll(rooms: OfficeRoom[]): OfficeRoom[] {
  return rooms.map((room) => {
    const objects = furnishRoom(room);
    return objects.length > 0 ? { ...room, objects } : { ...room };
  });
}
