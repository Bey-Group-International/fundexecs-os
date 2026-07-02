export type RoomDef = {
  key: string;
  label: string;
  imagePath: string;
  col: number;
  row: number;
  href: string;
};

/**
 * An interactive zone inside a room. The player walks into it and an iframe
 * overlay appears. Coordinates are relative to the room's top-left corner in
 * world pixels. In future this can be sourced from Tiled object layers.
 */
export type ZoneDef = {
  id: string;
  roomKey: string;
  /** World-space rect. x/y are room-relative offsets from room top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  title: string;
};

/**
 * Sentinel value in a ZoneDef url field.
 * OfficeTabs replaces it at runtime with the user's actual Calendly scheduling URL
 * (from user_metadata.calendly_scheduling_url, falling back to CALENDLY_DEFAULT_URL).
 */
export const ZONE_URL_CALENDLY = "{{calendly}}";
export const CALENDLY_DEFAULT_URL = "https://calendly.com/fundexecs";

export const IFRAME_ZONES: ZoneDef[] = [
  {
    id: "boardroom-calendly",
    roomKey: "boardroom",
    x: 48, y: 48, w: 288, h: 192,
    url: ZONE_URL_CALENDLY,
    title: "Schedule a Meeting",
  },
  {
    id: "trading-market-data",
    roomKey: "trading",
    x: 48, y: 48, w: 288, h: 192,
    url: "https://widget.finnhub.io/widgets/stocks/chart?symbol=SPY&watermarkColor=%231db954&backgroundColor=%230f172a&textColor=white",
    title: "Market Data",
  },
  {
    id: "reception-lp-portal",
    roomKey: "reception",
    x: 48, y: 48, w: 288, h: 192,
    // Intentionally no default URL: the zone only renders when an LP portal
    // link is injected via zoneUrlOverrides["lp-portal"]; otherwise dropped.
    url: "{{lp-portal}}",
    title: "LP Portal",
  },
];

/** Interactive object — a furniture hotspot with a "press X" prompt. */
export type InteractiveObject = {
  id: string;
  roomKey: string;
  /** Position within the room, px from room origin (tile center). */
  x: number;
  y: number;
  label: string;
  icon: string;
  href?: string;
  event?: string;
};

// Positions match furniture placed in office-world.tmj (tile*32 + 16).
export const INTERACTIVE_OBJECTS: InteractiveObject[] = [
  { id: "ceo-desk",        roomKey: "ceo",       x: 5*32+16, y: 2*32+16, label: "CEO Dashboard",   icon: "◆", href: "/dashboard" },
  { id: "board-table",     roomKey: "boardroom", x: 6*32+16, y: 4*32+16, label: "Start Meeting",   icon: "▶", event: "office:start-meeting" },
  { id: "board-whiteboard",roomKey: "boardroom", x: 1*32+16, y: 1*32+16, label: "Ask Earn",        icon: "✦", event: "earn:open-with-context" },
  { id: "trading-screens", roomKey: "trading",   x: 5*32+16, y: 1*32+16, label: "View Deals",      icon: "◈", href: "/dashboard/deals" },
  { id: "research-shelf",  roomKey: "research",  x: 2*32+16, y: 1*32+16, label: "Research Brief",  icon: "✦", event: "earn:open-with-context" },
  { id: "office-cooler",   roomKey: "office",    x: 10*32+16, y: 7*32+16, label: "Ask Earn",       icon: "✦", event: "earn:open-with-context" },
  { id: "ops-screens",     roomKey: "ops",       x: 6*32+16, y: 2*32+16, label: "Automation Hub",  icon: "⚙", href: "/dashboard/automation" },
  { id: "legal-desk",      roomKey: "legal",     x: 6*32+16, y: 3*32+16, label: "Capital",         icon: "◈", href: "/dashboard/capital" },
  { id: "marketing-board", roomKey: "marketing", x: 1*32+16, y: 1*32+16, label: "Marketing Hub",   icon: "◉", href: "/dashboard/marketing" },
  { id: "reception-desk",  roomKey: "reception", x: 4*32+16, y: 2*32+16, label: "Investor Relations", icon: "⬢", href: "/dashboard/investor-relations" },
];

export type RoomAction = {
  id: string;
  label: string;
  icon: string;
  /** If set, opens this path on click. */
  href?: string;
  /** If set, dispatches this window CustomEvent on click (no detail). */
  event?: string;
};

export const ROOM_ACTIONS: Record<string, RoomAction[]> = {
  ceo: [
    { id: "ask-earn", label: "Ask Earn",       icon: "✦", event: "earn:open-with-context" },
    { id: "dashboard",label: "Dashboard",      icon: "⌂", href: "/dashboard" },
  ],
  boardroom: [
    { id: "start-meeting", label: "Start Meeting", icon: "▶", event: "office:start-meeting" },
    { id: "ask-earn",      label: "Ask Earn",       icon: "✦", event: "earn:open-with-context" },
  ],
  trading: [
    { id: "view-deals",  label: "View Deals",     icon: "◈", href: "/dashboard/deals" },
    { id: "add-deal",    label: "Add Deal",        icon: "+", href: "/dashboard/deals/new" },
  ],
  research: [
    { id: "ask-earn",    label: "Research Brief",  icon: "✦", event: "earn:open-with-context" },
    { id: "dashboard",   label: "Dashboard",       icon: "⌂", href: "/dashboard" },
  ],
  office: [
    { id: "ask-earn",    label: "Ask Earn",        icon: "✦", event: "earn:open-with-context" },
  ],
  ops: [
    { id: "automation",  label: "Automation Hub",  icon: "⚙", href: "/dashboard/automation" },
    { id: "ask-earn",    label: "Ask Earn",        icon: "✦", event: "earn:open-with-context" },
  ],
  legal: [
    { id: "capital",     label: "Capital",         icon: "◈", href: "/dashboard/capital" },
    { id: "ask-earn",    label: "Ask Earn",        icon: "✦", event: "earn:open-with-context" },
  ],
  marketing: [
    { id: "marketing",   label: "Marketing Hub",   icon: "◉", href: "/dashboard/marketing" },
    { id: "ask-earn",    label: "Ask Earn",        icon: "✦", event: "earn:open-with-context" },
  ],
  reception: [
    { id: "ask-earn",    label: "Ask Earn",        icon: "✦", event: "earn:open-with-context" },
    { id: "office-tour", label: "Office Tour",     icon: "◎", event: "fx:open-tour" },
  ],
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
