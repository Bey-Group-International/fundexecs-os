// Command Center — map geometry.
//
// The world is generated deterministically from room + corridor definitions so
// the layout is identical on every render and trivially extensible to the full
// ~18-room brief later. Six zones ship in v1: the central Command Center Hub
// plus five workflow offices wired by 2-wide corridors.

import type { Cell, RoomDef, TileType, WorldMap } from "./types";

export const TILE = 32;
export const COLS = 44;
export const ROWS = 28;

// Room accents reuse the shipped agent palette (lib/agents.ts) so the office
// reads as the same brand as the rest of FundExecs OS.
export const ROOMS: RoomDef[] = [
  {
    id: "mandate",
    name: "Mandate Engine Office",
    short: "MANDATE ENGINE",
    workflow: "Deal intake · thesis · mandate fit",
    rect: { x: 2, y: 2, w: 12, h: 8 },
    accent: "#f97316", // deal_sourcer
    door: { x: 8, y: 9 },
    desks: [
      { x: 5, y: 3 },
      { x: 10, y: 3 },
    ],
    stand: [
      { x: 5, y: 4 },
      { x: 10, y: 4 },
    ],
    features: ["mandate_board", "deal_intake_terminal"],
  },
  {
    id: "relationship",
    name: "Relationship Graph Office",
    short: "RELATIONSHIP GRAPH",
    workflow: "LP network · warm paths · intros",
    rect: { x: 30, y: 2, w: 12, h: 8 },
    accent: "#f59e0b", // investor_relations
    door: { x: 35, y: 9 },
    desks: [
      { x: 33, y: 3 },
      { x: 38, y: 3 },
    ],
    stand: [
      { x: 33, y: 4 },
      { x: 38, y: 4 },
    ],
    features: ["graph_wall", "lp_network_console"],
  },
  {
    id: "hub",
    name: "Command Center Hub",
    short: "COMMAND CENTER",
    workflow: "Earn orchestration · live execution",
    rect: { x: 16, y: 9, w: 12, h: 8 },
    accent: "#38bdf8", // brand accent
    door: { x: 21, y: 16 },
    desks: [
      { x: 18, y: 10 },
      { x: 25, y: 10 },
    ],
    // Hub stand cells double as the executive "bench" around Earn.
    stand: [
      { x: 18, y: 14 },
      { x: 19, y: 15 },
      { x: 24, y: 15 },
      { x: 25, y: 14 },
    ],
    features: ["central_dashboard_screen", "earn_terminal", "executive_status_wall"],
  },
  {
    id: "outbound",
    name: "Outbound Engine Office",
    short: "OUTBOUND ENGINE",
    workflow: "Sequences · campaigns · conversion",
    rect: { x: 2, y: 19, w: 12, h: 7 },
    accent: "#fbbf24", // rainmaker
    door: { x: 8, y: 19 },
    desks: [
      { x: 5, y: 24 },
      { x: 10, y: 24 },
    ],
    stand: [
      { x: 5, y: 23 },
      { x: 10, y: 23 },
    ],
    features: ["campaign_terminal", "sequencer_panel"],
  },
  {
    id: "diligence",
    name: "Diligence Engine Office",
    short: "DILIGENCE ENGINE",
    workflow: "Doc parsing · risk flags · memos",
    rect: { x: 30, y: 19, w: 12, h: 7 },
    accent: "#ef4444", // diligence
    door: { x: 35, y: 19 },
    desks: [
      { x: 33, y: 24 },
      { x: 38, y: 24 },
    ],
    stand: [
      { x: 33, y: 23 },
      { x: 38, y: 23 },
    ],
    features: ["data_room_portal", "checklist_terminal"],
  },
  {
    id: "capital",
    name: "Capital Stack Office",
    short: "CAPITAL STACK",
    workflow: "Financing · waterfall · scenarios",
    rect: { x: 18, y: 20, w: 8, h: 6 },
    accent: "#14b8a6", // capital_connector
    door: { x: 21, y: 20 },
    desks: [
      { x: 20, y: 24 },
      { x: 23, y: 24 },
    ],
    stand: [
      { x: 20, y: 23 },
      { x: 23, y: 23 },
    ],
    features: ["modeling_terminal", "scenario_screen"],
  },
];

export const ROOM_BY_ID: Record<string, RoomDef> = Object.fromEntries(
  ROOMS.map((r) => [r.id, r]),
);

// 2-wide corridors painted over the void (and through room walls at the door
// columns) to wire every office into the hub.
const CORRIDORS: { x: number; y: number; w: number; h: number }[] = [
  { x: 8, y: 9, w: 2, h: 11 }, // left spine: Mandate ↕ Outbound
  { x: 34, y: 9, w: 2, h: 11 }, // right spine: Relationship ↕ Diligence
  { x: 8, y: 11, w: 9, h: 2 }, // left spine → hub left wall
  { x: 27, y: 11, w: 8, h: 2 }, // hub right wall → right spine
  { x: 21, y: 16, w: 2, h: 5 }, // hub bottom → Capital
];

function fillRect(
  tiles: TileType[][],
  rect: { x: number; y: number; w: number; h: number },
  border: TileType,
  inner: TileType,
) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const edge =
        x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
      tiles[y][x] = edge ? border : inner;
    }
  }
}

export function buildMap(): WorldMap {
  const tiles: TileType[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => "void" as TileType),
  );

  // Rooms first: walled boxes with floor interiors.
  for (const room of ROOMS) fillRect(tiles, room.rect, "wall", "floor");

  // Corridors carve openings through walls and connect the void.
  for (const c of CORRIDORS) {
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        if (y < 0 || x < 0 || y >= ROWS || x >= COLS) continue;
        tiles[y][x] = "hall";
      }
    }
  }

  // Mark explicit door thresholds + room features for the renderer.
  for (const room of ROOMS) {
    tiles[room.door.y][room.door.x] = "door";
    for (const d of room.desks) tiles[d.y][d.x] = "rug";
  }
  // Hub dashboard wall — a wide screen along the top interior.
  for (let x = 18; x <= 25; x++) tiles[10][x] = "screen";

  const walkable: boolean[][] = tiles.map((row) =>
    row.map((t) => t === "floor" || t === "hall" || t === "door" || t === "rug"),
  );

  return { cols: COLS, rows: ROWS, tile: TILE, tiles, walkable, rooms: ROOMS };
}

export function cellCenter(cell: Cell, tile = TILE): { px: number; py: number } {
  return { px: cell.x * tile + tile / 2, py: cell.y * tile + tile / 2 };
}

/** Which room (if any) contains a cell — used for hover/labels. */
export function roomAt(cell: Cell): RoomDef | null {
  for (const r of ROOMS) {
    if (
      cell.x >= r.rect.x &&
      cell.x < r.rect.x + r.rect.w &&
      cell.y >= r.rect.y &&
      cell.y < r.rect.y + r.rect.h
    ) {
      return r;
    }
  }
  return null;
}
