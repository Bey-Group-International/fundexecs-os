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
export const OFFICE_COLS = 40;
export const OFFICE_ROWS = 24;
export const OFFICE_WIDTH = OFFICE_COLS * TILE;
export const OFFICE_HEIGHT = OFFICE_ROWS * TILE;

/** Half-tile margin keeps avatars fully inside the floor when clamped. */
const EDGE_MARGIN = 0.6;

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
}

// A cross-shaped open-plan floor: four hub rooms in the corners, a Commons
// spanning the middle column. Rectangles are non-overlapping with a one-tile
// corridor between them so avatars can flow across the whole office.
export const ROOMS: OfficeRoom[] = [
  {
    key: "build",
    label: "Build Studio",
    hub: "build",
    x: 1,
    y: 1,
    w: 13,
    h: 10,
    accent: "#8b5cf6",
    purpose: "Firm identity, brand, and materials.",
  },
  {
    key: "source",
    label: "Source Floor",
    hub: "source",
    x: 26,
    y: 1,
    w: 13,
    h: 10,
    accent: "#f59e0b",
    purpose: "LP, deal, and partner pipelines.",
  },
  {
    key: "run",
    label: "Run War Room",
    hub: "run",
    x: 1,
    y: 13,
    w: 13,
    h: 10,
    accent: "#22d3ee",
    approvalGated: true,
    purpose: "Underwriting, diligence, and IC.",
  },
  {
    key: "execute",
    label: "Execute Ops",
    hub: "execute",
    x: 26,
    y: 13,
    w: 13,
    h: 10,
    accent: "#22c55e",
    approvalGated: true,
    purpose: "Capital, reporting, and fund admin.",
  },
  {
    key: "commons",
    label: "The Commons",
    hub: null,
    x: 15,
    y: 1,
    w: 10,
    h: 22,
    accent: "#d4a82a",
    purpose: "Where the team gathers and Earn coordinates.",
  },
];

export const ROOM_BY_KEY: Record<string, OfficeRoom> = Object.fromEntries(
  ROOMS.map((r) => [r.key, r]),
);

/** Human avatars spawn near the bottom of the Commons. */
export const SPAWN = { x: 20, y: 19 };

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
