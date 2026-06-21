// Command Center — spatial office world types.
//
// A Gather-style, top-down office re-skinned for FundExecs OS. Everything here
// is pure data: no DOM, no React. The renderer (WorldCanvas) and the simulation
// (engine) consume these shapes, and the adapter layer can swap demo state for
// live agent/task data without touching geometry.

export type TileType =
  | "void" // outside the building — non-walkable, dark
  | "floor" // room interior
  | "hall" // connecting corridor
  | "wall" // room border
  | "door" // walkable threshold between hall and room
  | "rug" // accent floor under a workstation cluster
  | "screen"; // the hub dashboard wall (non-walkable feature)

export interface Cell {
  x: number;
  y: number;
}

export interface RoomDef {
  id: string;
  name: string;
  /** Short label drawn on the floor. */
  short: string;
  /** The private-market workflow this office maps to. */
  workflow: string;
  rect: { x: number; y: number; w: number; h: number };
  /** Hex accent (matches the room's lead agent color where possible). */
  accent: string;
  /** Walkable threshold cell on the room border. */
  door: Cell;
  /** Non-walkable workstation/feature cells (interaction hotspots). */
  desks: Cell[];
  /** Walkable cells where an avatar stands to "work" a desk. */
  stand: Cell[];
  features: string[];
}

export interface WorldMap {
  cols: number;
  rows: number;
  tile: number;
  tiles: TileType[][]; // [row][col]
  walkable: boolean[][]; // [row][col]
  rooms: RoomDef[];
}

export type AvatarState =
  | "idle"
  | "walk"
  | "work"
  | "delegate" // Earn issuing tasks at the hub
  | "receive"; // an exec acknowledging a handoff

export type Facing = "down" | "up" | "left" | "right";

export interface AvatarDef {
  /** Agent key from lib/agents.ts, or "earn". */
  id: string;
  name: string;
  role: string;
  color: string;
  /** Room id this avatar calls home / returns to when idle. */
  homeRoom: string;
  /** Initial spawn cell (usually a stand cell or hub bench slot). */
  spawn: Cell;
  /** Two-letter monogram stamped on the coin. */
  monogram: string;
  /** Earn renders the real coin asset and can delegate. */
  isEarn: boolean;
}

export interface AvatarRuntime {
  def: AvatarDef;
  /** Pixel center, in map space (cell * tile + tile/2). */
  px: number;
  py: number;
  cell: Cell;
  state: AvatarState;
  facing: Facing;
  /** Remaining cells to walk (goal last). */
  path: Cell[];
  /** ms accumulator for the active animation. */
  animClock: number;
  /** Current task label, if working. */
  task: string | null;
  /** 0..1 progress while working. */
  progress: number;
  /** Transient ring pulse strength for delegate/receive cues. */
  pulse: number;
}

export type ChatRole = "user" | "earn";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** Optional structured recommendation block. */
  detail?: string[];
  /** When true the message offers approve/automate actions. */
  awaitsApproval?: boolean;
  ts: number;
}

export type FlowKind = "A" | "B";

/** Live state surfaced to the UI on every change. */
export interface WorldStatus {
  flow: FlowKind | null;
  phase: string;
  running: boolean;
  awaitingApproval: boolean;
  /** Avatar ids currently executing. */
  active: string[];
}
