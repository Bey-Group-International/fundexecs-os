// The Virtual Office spatial layout — the "systems" backbone of the reboot.
//
// This is pure data + geometry so the map, rooms, and agent desks are a single
// source of truth that both the canvas renderer and the presence logic read
// from, and so the geometry is unit-testable without a DOM. Coordinates are in
// TILE units (floats allowed for smooth movement); multiply by TILE for pixels.
//
// SoWork-style spatial office, mapped onto FundExecs' own architecture: the
// four operational hubs become rooms, each staffed by the AI agents that live
// in that hub, with a central Commons where humans spawn and Earn coordinates.
import { AGENTS, type AgentDefinition } from "@/lib/agents";
import type { Hub } from "@/lib/supabase/database.types";

/** Pixels per tile at native resolution. The canvas scales to fit its column. */
export const TILE = 26;
export const OFFICE_COLS = 48;
export const OFFICE_ROWS = 32;
export const OFFICE_WIDTH = OFFICE_COLS * TILE;
export const OFFICE_HEIGHT = OFFICE_ROWS * TILE;

/** Half-tile margin keeps avatars fully inside the floor when clamped. */
const EDGE_MARGIN = 0.6;

/**
 * Semantic classification for a room, driving affordances in the map editor
 * (and, later, ambient behavior). Purely additive: rooms without a `type` still
 * render and function exactly as before.
 */
export type RoomType =
  | "hub"
  | "meeting"
  | "focus"
  | "private"
  | "social"
  | "commons"
  | "reception"
  | "lounge"
  | "cafe"
  | "pod";

/**
 * The furniture / decor vocabulary. The first six kinds are the original
 * (back-compatible) set; the rest are the premium prop catalogue drawn by the
 * vector prop engine (components/office/officeProps.ts).
 */
export type OfficeObjectKind =
  // legacy
  | "desk"
  | "plant"
  | "whiteboard"
  | "couch"
  | "table"
  | "screen"
  // premium catalogue
  | "chair"
  | "monitor"
  | "plant_lg"
  | "armchair"
  | "coffee_table"
  | "meeting_table"
  | "tv"
  | "bookshelf"
  | "rug"
  | "rug_round"
  | "reception_desk"
  | "cafe_counter"
  | "coffee_machine"
  | "water_cooler"
  | "wall_art"
  | "window"
  | "divider"
  | "pod"
  | "lamp"
  | "server_rack";

/**
 * A decorative/functional prop placed inside the office floor. Coordinates are
 * in TILE space (top-left origin), like everything else in this module. Objects
 * are optional layout data — the renderer draws them if present, ignores them if
 * not. `w`/`h` give a multi-tile footprint (default ~1 tile); `rot` orients the
 * piece (degrees, 0/90/180/270).
 */
export interface OfficeObject {
  /** Unique id within a layout (used for hit-testing and removal). */
  id: string;
  kind: OfficeObjectKind;
  /** Tile-space position (the object's anchor point). */
  x: number;
  y: number;
  /** Footprint in tiles (optional; the prop engine has sensible defaults). */
  w?: number;
  h?: number;
  /** Orientation in degrees (0 | 90 | 180 | 270). */
  rot?: number;
}

export interface OfficeRoom {
  /** Stable key; hub rooms use the hub key, the lounge uses "commons". */
  key: string;
  label: string;
  /** The hub this room hosts, or null for the shared Commons. */
  hub: Hub | null;
  /** Tile-space rectangle (top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Accent color (hex) for the room fill, label, and desks. */
  accent: string;
  /** Outward-facing hubs run behind an approval gate — flagged on the map. */
  approvalGated?: boolean;
  purpose: string;
  /** Semantic room classification (optional; defaulted by the layout store). */
  type?: RoomType;
  /** Placeable props inside the room (optional). */
  objects?: OfficeObject[];
}

// A premium, SoWork-style floor plan. Three vertical bands — hub rooms down the
// left and right, a central spine of lounge / Commons / reception — separated by
// two-tile vertical corridors, with horizontal corridors slotting focus pods and
// the cafe beneath the hubs. Every rectangle is non-overlapping and every room
// borders a corridor, so the whole floor is one connected, walkable network.
//
//   x:  1        15 17        31 33        47
//       ┌─build──┐  ┌─lounge──┐  ┌─source──┐   y 1
//       │  hub   │  │ social  │  │  hub    │
//       └────────┘  ├─commons─┤  └─────────┘   y 11 (corridor)
//       ┌─run────┐  │ gather  │  ┌─execute─┐   y 15
//       │  hub   │  ├reception┤  │  hub    │
//       └────────┘  │  lobby  │  └─────────┘   y 25 (corridor)
//       ┌pod┐┌pod┐  │  SPAWN  │  ┌─cafe────┐   y 27
//       └───┘└───┘  └─────────┘  └─────────┘   y 31
export const ROOMS: OfficeRoom[] = [
  {
    key: "build",
    label: "Build Studio",
    hub: "build",
    x: 1,
    y: 1,
    w: 14,
    h: 10,
    accent: "#5566a6",
    type: "hub",
    purpose: "Firm identity, brand, and materials.",
  },
  {
    key: "source",
    label: "Source Floor",
    hub: "source",
    x: 33,
    y: 1,
    w: 14,
    h: 10,
    accent: "#b08d57",
    type: "hub",
    purpose: "LP, deal, and partner pipelines.",
  },
  {
    key: "run",
    label: "Run War Room",
    hub: "run",
    x: 1,
    y: 15,
    w: 14,
    h: 10,
    accent: "#3d7387",
    approvalGated: true,
    type: "hub",
    purpose: "Underwriting, diligence, and IC.",
  },
  {
    key: "execute",
    label: "Execute Ops",
    hub: "execute",
    x: 33,
    y: 15,
    w: 14,
    h: 10,
    accent: "#4a7a5e",
    approvalGated: true,
    type: "hub",
    purpose: "Capital, reporting, and fund admin.",
  },
  {
    key: "lounge",
    label: "The Lounge",
    hub: null,
    x: 17,
    y: 1,
    w: 14,
    h: 8,
    accent: "#8a7096",
    type: "lounge",
    purpose: "Soft seating for casual syncs and downtime.",
  },
  {
    key: "commons",
    label: "The Commons",
    hub: null,
    x: 17,
    y: 10,
    w: 14,
    h: 10,
    accent: "#c9a24a",
    type: "commons",
    purpose: "Where the team gathers and Earn coordinates.",
  },
  {
    key: "reception",
    label: "Reception",
    hub: null,
    x: 17,
    y: 21,
    w: 14,
    h: 9,
    accent: "#5a7797",
    type: "reception",
    purpose: "The lobby — where people arrive and are welcomed.",
  },
  {
    key: "pod-1",
    label: "Focus Pod A",
    hub: null,
    x: 1,
    y: 27,
    w: 6,
    h: 4,
    accent: "#5b6673",
    type: "pod",
    purpose: "A quiet booth for heads-down, single-track work.",
  },
  {
    key: "pod-2",
    label: "Focus Pod B",
    hub: null,
    x: 9,
    y: 27,
    w: 6,
    h: 4,
    accent: "#5b6673",
    type: "pod",
    purpose: "A quiet booth for heads-down, single-track work.",
  },
  {
    key: "cafe",
    label: "The Cafe",
    hub: null,
    x: 33,
    y: 27,
    w: 14,
    h: 4,
    accent: "#a6774d",
    type: "cafe",
    purpose: "Coffee, counter seating, and informal collisions.",
  },
];

export const ROOM_BY_KEY: Record<string, OfficeRoom> = Object.fromEntries(
  ROOMS.map((r) => [r.key, r]),
);

/** Human avatars spawn just inside the Reception lobby, where people arrive. */
export const SPAWN = { x: 24, y: 26 };

/** Radius (tiles) within which spatial conversation is possible. */
export const PROXIMITY_RADIUS = 4;

function contains(room: OfficeRoom, x: number, y: number): boolean {
  return x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h;
}

/** Which room contains a tile-space point, or null if in a corridor. */
export function roomAt(x: number, y: number): OfficeRoom | null {
  return ROOMS.find((room) => contains(room, x, y)) ?? null;
}

/** Keep a tile-space point inside the office floor. */
export function clampToBounds(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, EDGE_MARGIN), OFFICE_COLS - EDGE_MARGIN),
    y: Math.min(Math.max(y, EDGE_MARGIN), OFFICE_ROWS - EDGE_MARGIN),
  };
}

export interface AgentDesk {
  agent: AgentDefinition;
  /** Desk position in tile space. */
  x: number;
  y: number;
  room: OfficeRoom;
}

/**
 * Deterministically seat every AI agent at a desk inside its hub's room (Earn,
 * the null-hub coordinator, sits in the Commons). Same input → same layout, so
 * every client renders agents identically without syncing them over presence.
 *
 * Accepts the active room set so a customized (persisted) layout seats agents in
 * its own rooms; defaults to the built-in {@link ROOMS}.
 */
export function agentDesks(rooms: OfficeRoom[] = ROOMS): AgentDesk[] {
  const byRoom = new Map<string, AgentDefinition[]>();
  for (const agent of AGENTS) {
    const key = agent.hub ?? "commons";
    const list = byRoom.get(key) ?? [];
    list.push(agent);
    byRoom.set(key, list);
  }

  const desks: AgentDesk[] = [];
  for (const room of rooms) {
    const agents = byRoom.get(room.key) ?? [];
    if (agents.length === 0) continue;

    // Leave room at the top for the label and a margin on every side, then lay
    // the desks out on an evenly spaced grid within the interior.
    const padX = 2;
    const padTop = 3;
    const padBottom = 1.5;
    const innerW = room.w - padX * 2;
    const innerH = room.h - padTop - padBottom;
    const cols = Math.min(3, agents.length);
    const rows = Math.ceil(agents.length / cols);

    agents.forEach((agent, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const gx = cols === 1 ? innerW / 2 : (innerW * col) / (cols - 1);
      const gy = rows === 1 ? innerH / 2 : (innerH * row) / (rows - 1);
      desks.push({
        agent,
        x: room.x + padX + gx,
        y: room.y + padTop + gy,
        room,
      });
    });
  }
  return desks;
}
