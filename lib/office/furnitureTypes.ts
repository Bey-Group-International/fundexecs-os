/**
 * The furniture kinds the office renderer can draw, plus a runtime palette list
 * and human-readable labels.
 *
 * Kept deliberately free of any Phaser / renderer import so the placement store
 * and the editor UI can share the type and the palette without pulling in the
 * (Phaser-dependent) officeEnvironment module. officeEnvironment re-imports
 * `PieceType` from here so the union and the runtime array can never drift.
 */
export const PIECE_TYPES = [
  "desk",
  "console",
  "screens",
  "shelf",
  "table",
  "safe",
  "reception",
  "coffee",
  "sofa",
  "plant",
] as const;

export type PieceType = (typeof PIECE_TYPES)[number];

/** Palette labels for the space editor. */
export const PIECE_LABELS: Record<PieceType, string> = {
  desk: "Desk",
  console: "Command console",
  screens: "Terminal wall",
  shelf: "Filing shelf",
  table: "Boardroom table",
  safe: "Treasury safe",
  reception: "Reception desk",
  coffee: "Coffee bar",
  sofa: "Lounge sofa",
  plant: "Plant",
};
