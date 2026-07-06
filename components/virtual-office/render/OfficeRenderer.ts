/**
 * FundExecs OS — Rendering-layer seam.
 *
 * `OfficeRenderer` is the framework-agnostic contract for *drawing* the
 * virtual office and reporting pointer interaction back out. It is the single
 * seam that lets the Rendering layer be swapped — Phaser Canvas2D today,
 * Three.js/WebGPU, Unity WebGL, Unreal Pixel Streaming, or NVIDIA Omniverse
 * tomorrow — WITHOUT touching the other four layers:
 *
 *   • Office Intelligence — `program/officeProgram.ts` (agents, rooms, tiers,
 *     task routing). Owns *what should happen*.
 *   • NPC Behavior — path following, seating, facing, program→animation
 *     resolution. Owns *how an actor moves and emotes*.
 *   • Workflow State — stages, approval gates, meetings, audit events.
 *   • Rendering — THIS interface. Owns *pixels*: floor, walls, furniture,
 *     avatars, camera. Knows nothing about tasks, sockets, or approvals.
 *   • Interaction — pointer/keyboard events surfaced via the `onActorClick`
 *     / `onFloorClick` callbacks, then interpreted by the layers above.
 *
 * The types below deliberately use ONLY plain data plus the domain enums
 * (`AgentState`, `RoomKey`) — never a Phaser, Three.js, or DOM-3D type — so an
 * implementation can be written against any engine. The current Phaser
 * `OfficeScene` already conforms to this shape conceptually: `buildFloor()`
 * ≈ its tilemap + wall + furniture setup, `addActor()` ≈ `_spawnNpc()`, the
 * per-actor mutators ≈ its `program:*` event handlers, and `update()` ≈ the
 * scene's `update()` loop.
 */

import type { AgentState, RoomKey } from "../program/officeProgram";

/**
 * Four-way facing shared by every renderer. Matches `AvatarFacing` in
 * `avatar/ExecutiveAvatar.ts`; kept as an independent alias here so the
 * rendering contract does not depend on the Phaser avatar implementation.
 */
export type ActorFacing = "down" | "up" | "left" | "right";

/** A world-space point in the renderer's floor coordinate system. */
export type RenderVec2 = { x: number; y: number };

/**
 * Everything a renderer needs to spawn one actor (an AI executive agent, a
 * remote human player, or the local user). Purely descriptive — no engine
 * handles. `id` is the stable key used by every later mutator (e.g.
 * `agent:earn`, or a network player id).
 */
export type ActorSpec = {
  /** Stable actor id, unique on the floor. */
  id: string;
  /** Initial world position. */
  x: number;
  y: number;
  /** Initial facing. */
  facing: ActorFacing;
  /** Display name rendered above the figure. */
  name: string;
  /**
   * Program agent id when this actor is an AI executive, else null (remote
   * humans / the local user). Drives role silhouette + accent selection.
   */
  agentId: string | null;
  /** Character/sprite key from the character config, when applicable. */
  spriteKey?: string;
  /** Role accent color (hex) for auras, rim light, and name tag. */
  accent?: string;
  /** Initial program state; defaults to "idle" if omitted. */
  state?: AgentState;
  /** Whether the actor starts seated at a desk. */
  seated?: boolean;
  /** Kind of actor, so the renderer can pick culling / label treatment. */
  kind?: "agent" | "remote" | "user";
};

/** Callback fired when an actor's silhouette is clicked/tapped. */
export type ActorClickHandler = (actorId: string) => void;

/** Callback fired when empty floor is clicked/tapped (world coordinates). */
export type FloorClickHandler = (x: number, y: number) => void;

/**
 * The rendering contract. An implementation is a "dumb" view: it draws what
 * it is told and reports pointer events. All authority — which agent moves
 * where, what state it is in, when a room activates — lives in the layers
 * above and reaches the renderer only through these calls.
 */
export interface OfficeRenderer {
  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Attach the renderer to a DOM container and start its render loop.
   * May be async (e.g. a WebGPU adapter request or asset preload).
   */
  mount(container: HTMLElement): void | Promise<void>;

  /** Tear down the render loop, GPU resources, and DOM canvas. */
  destroy(): void;

  /**
   * Advance one frame. `deltaMs` is the elapsed time since the previous
   * frame. Engines with their own internal loop (Phaser, Three.js
   * `requestAnimationFrame`) may treat this as a no-op and drive themselves.
   */
  update(deltaMs: number): void;

  // ── World ─────────────────────────────────────────────────────────────────

  /**
   * Build the static world: room floors, partition walls with door gaps, and
   * per-department furniture. Called once after `mount`, before any actor is
   * added. (Phaser equivalent: tilemap + `createWallVisuals` + `createFurniture`.)
   */
  buildFloor(): void;

  /** Pan/zoom the camera to frame the given room. */
  focusRoom(roomKey: RoomKey): void;

  /**
   * Make the camera follow an actor, or pass `null` to release follow and
   * return to free/default framing.
   */
  follow(actorId: string | null): void;

  // ── Actors ────────────────────────────────────────────────────────────────

  /** Spawn an actor from a descriptor. Idempotent per `spec.id`. */
  addActor(spec: ActorSpec): void;

  /** Despawn an actor and release its resources. No-op if unknown. */
  removeActor(id: string): void;

  /** Set an actor's world position (the layer above owns pathing/velocity). */
  moveActor(id: string, x: number, y: number): void;

  /** Set an actor's facing direction. */
  setActorFacing(id: string, facing: ActorFacing): void;

  /**
   * Set an actor's program state. The renderer resolves it into a visual
   * animation (typing, reviewing, presenting, aura color, rim light, …).
   */
  setActorState(id: string, state: AgentState): void;

  /** Seat or unseat an actor at its desk (seated is the idle stance). */
  setActorSeated(id: string, seated: boolean): void;

  // ── Interaction ───────────────────────────────────────────────────────────

  /** Register the handler invoked when an actor is clicked. */
  onActorClick(cb: ActorClickHandler): void;

  /** Register the handler invoked when empty floor is clicked. */
  onFloorClick(cb: FloorClickHandler): void;
}
