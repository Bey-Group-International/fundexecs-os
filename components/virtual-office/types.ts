export type RoomDef = {
  key: string;
  label: string;
  imagePath: string;
  col: number;
  row: number;
  href: string;
};

export const TILE_SIZE = 32;
export const ROOM_COLS = 12; // tiles wide
export const ROOM_ROWS_COUNT = 9; // tiles tall
export const ROOM_W = TILE_SIZE * ROOM_COLS; // 384
export const ROOM_H = TILE_SIZE * ROOM_ROWS_COUNT; // 288
export const GRID_COLS = 3;
export const GRID_ROWS = 3;
export const WORLD_W = ROOM_W * GRID_COLS; // 1152
export const WORLD_H = ROOM_H * GRID_ROWS; // 864

export const PLAYER_SPEED = 160;
export const WALL_THICKNESS = 8;
export const DOOR_GAP = 64;

export const ROOMS: RoomDef[] = [
  { key: "ceo",       label: "CEO Office",    imagePath: "/assets/fundexecs/office/rooms/day/ceo-office-day-empty.png",      col: 0, row: 0, href: "/dashboard" },
  { key: "boardroom", label: "Boardroom",     imagePath: "/assets/fundexecs/office/rooms/day/boardroom-day-empty.png",        col: 1, row: 0, href: "/dashboard" },
  { key: "trading",   label: "Trading Floor", imagePath: "/assets/fundexecs/office/rooms/day/trading-floor-day-empty.png",    col: 2, row: 0, href: "/dashboard/deals" },
  { key: "research",  label: "Research Hub",  imagePath: "/assets/fundexecs/office/rooms/day/research-hub-day-empty.png",     col: 0, row: 1, href: "/dashboard" },
  { key: "office",    label: "Main Office",   imagePath: "/assets/fundexecs/office/rooms/day/office-day-empty.png",           col: 1, row: 1, href: "/dashboard" },
  { key: "ops",       label: "Operations",    imagePath: "/assets/fundexecs/office/rooms/day/operations-hub-day-empty.png",   col: 2, row: 1, href: "/dashboard/automation" },
  { key: "legal",     label: "Legal Corner",  imagePath: "/assets/fundexecs/office/rooms/day/legal-corner-day-empty.png",     col: 0, row: 2, href: "/dashboard/capital" },
  { key: "marketing", label: "Marketing",     imagePath: "/assets/fundexecs/office/rooms/day/marketing-saloon-day-empty.png", col: 1, row: 2, href: "/dashboard/marketing" },
  { key: "reception", label: "Reception",     imagePath: "/assets/fundexecs/office/rooms/day/reception-lounge-day-empty.png", col: 2, row: 2, href: "/dashboard" },
];

// Sprite animation rows — mirrors spriteFrameMap.ts
export const ANIM_ROWS = {
  idle:      0,
  walkDown:  1,
  walkUp:    2,
  walkLeft:  3,
  walkRight: 4,
} as const;

export type PlayerAnimKey = keyof typeof ANIM_ROWS;
