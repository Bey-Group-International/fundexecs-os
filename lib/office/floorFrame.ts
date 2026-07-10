// Shared per-frame snapshot of the Executive Floor's characters.
//
// The Phaser OfficeScene is the authority for movement, collision, proximity and
// the camera. To render 3D avatars *on top of* the floor without re-rendering
// React every frame, the scene writes a plain snapshot here each tick and the
// R3F overlay (Floor3DLayer) reads it inside its own useFrame — so the 3D models
// stay locked to Phaser's smoothed follow-camera with zero React churn. Only the
// set of character ids (the `roster` string) changing drives a React re-render,
// which happens on spawn/despawn, not on movement.
//
// This is a deliberate module-level singleton: the dynamically-imported scene and
// the overlay share the same bundle, so they see the same object.

export type FloorFacing = "down" | "up" | "left" | "right";

export type FloorChar = {
  /** Stable id — "__you__" for the operator, "agent:<id>" for execs, peer id for remotes. */
  id: string;
  /** World-pixel position of the figure's feet (Phaser container origin). */
  x: number;
  y: number;
  facing: FloorFacing;
  moving: boolean;
  seated: boolean;
  /** Hex accent (role color) — tints the character's floor marker. */
  accent: string;
  name: string;
  isPlayer: boolean;
};

export type FloorCam = {
  /** Top-left world coordinate of the camera viewport. */
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** Canvas viewport size in CSS pixels (matches the overlay canvas 1:1). */
  w: number;
  h: number;
};

export type FloorFrame = {
  chars: FloorChar[];
  cam: FloorCam;
  /** Sorted, joined ids — cheap membership-change signal for the overlay. */
  roster: string;
};

const frame: FloorFrame = {
  chars: [],
  cam: { scrollX: 0, scrollY: 0, zoom: 2, w: 0, h: 0 },
  roster: "",
};

/** Called by the scene each tick with the current characters + camera. */
export function setFloorFrame(chars: FloorChar[], cam: FloorCam): void {
  frame.chars = chars;
  frame.cam = cam;
  let roster = "";
  // ids arrive in a stable order (player, then Map iteration), so no sort needed
  // for equality — but join defensively in case iteration order shifts.
  for (const c of chars) roster += c.id + "|";
  frame.roster = roster;
}

/** Read the latest snapshot (mutated in place — do not retain references). */
export function getFloorFrame(): FloorFrame {
  return frame;
}

/** Clear the snapshot (scene teardown), so a stale roster doesn't linger. */
export function clearFloorFrame(): void {
  frame.chars = [];
  frame.roster = "";
}
