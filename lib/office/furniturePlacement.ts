/**
 * FundExecs OS — user-placed furniture model (Space editor v2).
 *
 * The hand-authored per-room furniture lives in `officeEnvironment.ts`'s LAYOUT.
 * The space editor lets an operator add *extra* pieces on top of it; those live
 * here as a flat, JSON-serialisable list, persisted via {@link ./furnitureStore}
 * and merged into the render at `createFurniture` time. Coordinates are
 * ROOM-RELATIVE pixels (the same space as LAYOUT's rx/ry) so the merge is a
 * plain concatenation and pieces stay correct regardless of a room's grid slot.
 */
import type { PieceType } from "./furnitureTypes";

/** One operator-placed furniture piece, in room-relative pixels. */
export type PlacedPiece = {
  /** Stable id — React key, de-dupe, and hit-testing in the editor. */
  id: string;
  /** Which room it belongs to (must be a valid ROOMS key). */
  roomKey: string;
  /** Furniture kind — one of the renderer's PieceTypes. */
  type: PieceType;
  /** Room-relative x (0..ROOM_W). */
  x: number;
  /** Room-relative y (0..ROOM_H). */
  y: number;
};

/**
 * The built-in seed is empty: v2 is purely additive on top of the code-owned
 * LAYOUT, so an operator never has to re-author the default office.
 */
export const DEFAULT_PLACEMENTS: PlacedPiece[] = [];
