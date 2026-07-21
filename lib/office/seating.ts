// Seating for the Virtual Office — where characters SIT.
//
// Pure geometry/data (no DOM, no randomness), a sibling to `furnish.ts`: given a
// room's furniture, derive the set of {@link Seat}s a character can occupy — a
// desk chair to face a monitor, a spot around a meeting table, a couch cushion,
// a café stool. Same furniture in, same seats out, so agents can be pre-seated
// deterministically (every client agrees without syncing) and idle humans can
// auto-sit at the nearest free seat. The renderer/shell consume this; the
// geometry stays unit-testable without a canvas.
//
// COORDINATE CONTRACT (matches `layout.ts` + `furnish.ts`):
//   • All positions are in TILE space; `seat.x,y` is the SIT POINT where a
//     seated character's feet/anchor go, and `facing` points toward the piece.
//   • An object's `x,y` is its reference point (as `furnish.ts` lays them out:
//     a desk with a monitor above and a chair below share the same `x`).
import type { Facing } from "./avatarConfig";
import {
  agentDesks,
  type OfficeObject,
  type OfficeObjectKind,
  type OfficeRoom,
} from "./layout";
import { furnishRoom, PROP_SIZE } from "./furnish";

/**
 * A place a character can sit. `x,y` is the tile-space sit point (feet/anchor);
 * `facing` points toward the desk/table the seat serves; `roomKey` scopes it to
 * a room; `kind` is a coarse classification for the renderer.
 */
export interface Seat {
  x: number;
  y: number;
  facing: Facing;
  roomKey: string;
  kind: "desk" | "chair" | "couch" | "table" | "stool";
}

/** Round to 0.1-tile precision — mirrors `furnish.ts`, keeps seat ids stable. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Linear interpolation, guarding the single-step (`steps <= 1`) case. */
function lerp(a: number, b: number, i: number, steps: number): number {
  return steps <= 1 ? (a + b) / 2 : a + ((b - a) * i) / (steps - 1);
}

/**
 * Stable id for a seat — its room-scoped, rounded position. Room-scoped so seats
 * that round to the same tile in adjacent rooms never collide in an occupancy
 * set.
 */
export function seatKey(seat: Seat): string {
  return `${seat.roomKey}@${round(seat.x)},${round(seat.y)}`;
}

/** A seat inside a room, with its position clamped a half-tile in from the walls. */
function seatIn(
  room: OfficeRoom,
  x: number,
  y: number,
  facing: Facing,
  kind: Seat["kind"],
): Seat {
  const minX = room.x + 0.5;
  const maxX = room.x + room.w - 0.5;
  const minY = room.y + 0.5;
  const maxY = room.y + room.h - 0.5;
  return {
    x: round(Math.min(Math.max(x, minX), maxX)),
    y: round(Math.min(Math.max(y, minY), maxY)),
    facing,
    roomKey: room.key,
    kind,
  };
}

function footprint(obj: OfficeObject): { w: number; h: number } {
  const size = PROP_SIZE[obj.kind];
  return { w: obj.w ?? size.w, h: obj.h ?? size.h };
}

/** The four inward facings around a table centre. */
function facingToward(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/** Seats spaced around a table's footprint, each facing inward toward it. */
function ringSeats(
  room: OfficeRoom,
  obj: OfficeObject,
  kind: Seat["kind"],
): Seat[] {
  const { w, h } = footprint(obj);
  const cx = obj.x;
  const cy = obj.y;
  const hw = w / 2;
  const hh = h / 2;
  const gap = 0.7;
  const perSide = Math.max(1, Math.round(w / 2));
  const seats: Seat[] = [];
  for (let i = 0; i < perSide; i++) {
    const x = lerp(cx - hw * 0.6, cx + hw * 0.6, i, perSide);
    seats.push(seatIn(room, x, cy - hh - gap, "down", kind));
    seats.push(seatIn(room, x, cy + hh + gap, "up", kind));
  }
  seats.push(seatIn(room, cx - hw - gap, cy, "right", kind));
  seats.push(seatIn(room, cx + hw + gap, cy, "left", kind));
  return seats;
}

/** Soft seating: 1–2 sit points across the piece, facing outward ("down"). */
function softSeats(room: OfficeRoom, obj: OfficeObject): Seat[] {
  const { w } = footprint(obj);
  const n = w >= 2.5 ? 2 : 1;
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? obj.x : lerp(obj.x - w * 0.24, obj.x + w * 0.24, i, n);
    seats.push(seatIn(room, x, obj.y, "down", "couch"));
  }
  return seats;
}

/** Stools tucked in front of (below) a counter, facing it. */
function counterSeats(room: OfficeRoom, obj: OfficeObject): Seat[] {
  const { w, h } = footprint(obj);
  const n = Math.max(1, Math.round(w / 1.5));
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const x = lerp(obj.x - w * 0.32, obj.x + w * 0.32, i, n);
    seats.push(seatIn(room, x, obj.y + h / 2 + 0.6, "up", "stool"));
  }
  return seats;
}

const TABLE_KINDS: ReadonlySet<OfficeObjectKind> = new Set([
  "desk",
  "table",
  "meeting_table",
]);

/**
 * Derive the seats a room offers from its furniture — `room.objects` if present,
 * else the deterministic {@link furnishRoom} template. Every seat is clamped
 * inside the room bounds, and the ordering is deterministic (it follows the
 * furniture order). Pure: same room in, same seats out.
 */
export function seatsForRoom(room: OfficeRoom): Seat[] {
  const objects = room.objects ?? furnishRoom(room);
  // Nearest desk/table for orienting loose chairs.
  const tables = objects.filter((o) => TABLE_KINDS.has(o.kind));
  const nearestTable = (x: number, y: number): OfficeObject | null => {
    let best: OfficeObject | null = null;
    let bestD = Infinity;
    for (const t of tables) {
      const d = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  };

  const seats: Seat[] = [];
  for (const obj of objects) {
    switch (obj.kind) {
      case "desk": {
        // A seat just in front of (below) the desk, facing up toward it.
        const { h } = footprint(obj);
        seats.push(seatIn(room, obj.x, obj.y + h / 2 + 0.4, "up", "desk"));
        break;
      }
      case "chair": {
        const t = nearestTable(obj.x, obj.y);
        const facing = t ? facingToward(t.x - obj.x, t.y - obj.y) : "up";
        seats.push(seatIn(room, obj.x, obj.y, facing, "chair"));
        break;
      }
      case "meeting_table":
        seats.push(...ringSeats(room, obj, "table"));
        break;
      case "table":
        seats.push(...ringSeats(room, obj, "stool"));
        break;
      case "couch":
      case "armchair":
        seats.push(...softSeats(room, obj));
        break;
      case "cafe_counter":
        seats.push(...counterSeats(room, obj));
        break;
      default:
        break;
    }
  }
  return seats;
}

/** Every seat across a set of rooms, flattened. */
export function seatsForRooms(rooms: OfficeRoom[]): Seat[] {
  return rooms.flatMap((room) => seatsForRoom(room));
}

/**
 * Deterministically sit every AI agent at a desk seat in its own hub room, so
 * all agents render seated without syncing. Keyed by agent key. Agents in a room
 * are matched 1:1 to that room's desk seats in order; if a room has fewer desk
 * seats than agents (e.g. Earn in the deskless Commons), the agent falls back to
 * its {@link agentDesks} position facing up.
 */
export function agentSeats(rooms: OfficeRoom[]): Record<string, Seat> {
  const desks = agentDesks(rooms);

  // Desk seats available per room, consumed in order.
  const deskSeatsByRoom = new Map<string, Seat[]>();
  const usedByRoom = new Map<string, number>();
  for (const room of rooms) {
    deskSeatsByRoom.set(
      room.key,
      seatsForRoom(room).filter((s) => s.kind === "desk"),
    );
    usedByRoom.set(room.key, 0);
  }

  const out: Record<string, Seat> = {};
  for (const desk of desks) {
    const roomKey = desk.room.key;
    const seats = deskSeatsByRoom.get(roomKey) ?? [];
    const used = usedByRoom.get(roomKey) ?? 0;
    if (used < seats.length) {
      out[desk.agent.key] = seats[used];
      usedByRoom.set(roomKey, used + 1);
    } else {
      // Fallback: the agent's own desk position, facing its (implicit) desk.
      out[desk.agent.key] = seatIn(desk.room, desk.x, desk.y, "up", "desk");
    }
  }
  return out;
}

/**
 * The nearest free seat to a position, within `maxDist` tiles, whose id is not in
 * `occupied` — else null. Ties break by seat id for determinism. Used to auto-sit
 * an idle human when they stop near a chair/sofa.
 */
export function nearestFreeSeat(
  pos: { x: number; y: number },
  seats: Seat[],
  occupied: Set<string>,
  maxDist: number,
): Seat | null {
  const maxSq = maxDist * maxDist;
  let best: Seat | null = null;
  let bestD = Infinity;
  let bestKey = "";
  for (const seat of seats) {
    const key = seatKey(seat);
    if (occupied.has(key)) continue;
    const d = (seat.x - pos.x) ** 2 + (seat.y - pos.y) ** 2;
    if (d > maxSq) continue;
    if (d < bestD || (d === bestD && key < bestKey)) {
      bestD = d;
      best = seat;
      bestKey = key;
    }
  }
  return best;
}
