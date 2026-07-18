/**
 * Map asset catalog — tiles and objects for the 32×32 workspace editor.
 *
 * Each asset declares its default map layer, collision behavior, an optional
 * interaction role, PBR material, and a compact pixel recipe the map compositor
 * paints. Original FundExecs art; no third-party tilesets are used.
 */
import type { MapLayerId } from "../types";

export interface MapAssetDef {
  id: string;
  label: string;
  category:
    | "floor"
    | "wall"
    | "furniture"
    | "technology"
    | "signage"
    | "screen"
    | "decor"
    | "exterior"
    | "zone";
  defaultLayer: MapLayerId;
  /** Tiles this object spans (w×h in 32px tiles). */
  size: { w: number; h: number };
  collides: boolean;
  /** Interaction role → becomes a Tiled object property on export. */
  interaction?: "spawn" | "exit" | "entrance" | "meeting" | "jitsi" | "openWebsite" | "silent";
  materialId: string;
  /** Pixel recipe kind dispatched by the map compositor. */
  recipe: { kind: string; params: Record<string, number | string | boolean> };
}

const FABRIC = "cotton";

export const MAP_ASSETS: MapAssetDef[] = [
  // --- Floors ---
  { id: "floor-carpet", label: "Carpet", category: "floor", defaultLayer: "floor", size: { w: 1, h: 1 }, collides: false, materialId: "cotton", recipe: { kind: "floor", params: { tone: "carpet" } } },
  { id: "floor-wood", label: "Wood Floor", category: "floor", defaultLayer: "floor", size: { w: 1, h: 1 }, collides: false, materialId: "wood", recipe: { kind: "floor", params: { tone: "wood" } } },
  { id: "floor-marble", label: "Marble", category: "floor", defaultLayer: "floor", size: { w: 1, h: 1 }, collides: false, materialId: "stone", recipe: { kind: "floor", params: { tone: "marble" } } },
  { id: "floor-concrete", label: "Concrete", category: "floor", defaultLayer: "floor", size: { w: 1, h: 1 }, collides: false, materialId: "stone", recipe: { kind: "floor", params: { tone: "concrete" } } },
  { id: "ground-grass", label: "Grass", category: "exterior", defaultLayer: "ground", size: { w: 1, h: 1 }, collides: false, materialId: "stone", recipe: { kind: "floor", params: { tone: "grass" } } },
  { id: "ground-paving", label: "Paving", category: "exterior", defaultLayer: "ground", size: { w: 1, h: 1 }, collides: false, materialId: "stone", recipe: { kind: "floor", params: { tone: "paving" } } },

  // --- Walls ---
  { id: "wall-solid", label: "Wall", category: "wall", defaultLayer: "walls", size: { w: 1, h: 1 }, collides: true, materialId: "stone", recipe: { kind: "wall", params: { style: "solid" } } },
  { id: "wall-glass", label: "Glass Partition", category: "wall", defaultLayer: "walls", size: { w: 1, h: 1 }, collides: true, materialId: "glass", recipe: { kind: "wall", params: { style: "glass" } } },
  { id: "wall-window", label: "Window", category: "wall", defaultLayer: "walls", size: { w: 1, h: 1 }, collides: true, materialId: "glass", recipe: { kind: "wall", params: { style: "window" } } },

  // --- Furniture ---
  { id: "desk", label: "Desk", category: "furniture", defaultLayer: "furniture", size: { w: 2, h: 1 }, collides: true, materialId: "wood", recipe: { kind: "desk", params: {} } },
  { id: "desk-l", label: "L-Desk", category: "furniture", defaultLayer: "furniture", size: { w: 2, h: 2 }, collides: true, materialId: "wood", recipe: { kind: "desk", params: { shape: "l" } } },
  { id: "chair", label: "Chair", category: "furniture", defaultLayer: "furniture", size: { w: 1, h: 1 }, collides: false, materialId: "leather", recipe: { kind: "chair", params: {} } },
  { id: "table-round", label: "Round Table", category: "furniture", defaultLayer: "furniture", size: { w: 2, h: 2 }, collides: true, materialId: "wood", recipe: { kind: "table", params: { shape: "round" } } },
  { id: "table-conf", label: "Conference Table", category: "furniture", defaultLayer: "furniture", size: { w: 4, h: 2 }, collides: true, materialId: "wood", recipe: { kind: "table", params: { shape: "conf" } } },
  { id: "sofa", label: "Sofa", category: "furniture", defaultLayer: "furniture", size: { w: 2, h: 1 }, collides: true, materialId: FABRIC, recipe: { kind: "sofa", params: {} } },
  { id: "reception", label: "Reception Desk", category: "furniture", defaultLayer: "furniture", size: { w: 3, h: 1 }, collides: true, materialId: "wood", recipe: { kind: "desk", params: { shape: "reception" } } },
  { id: "bookshelf", label: "Bookshelf", category: "furniture", defaultLayer: "furniture", size: { w: 1, h: 1 }, collides: true, materialId: "wood", recipe: { kind: "shelf", params: {} } },

  // --- Technology ---
  { id: "monitor", label: "Monitor", category: "technology", defaultLayer: "technology", size: { w: 1, h: 1 }, collides: false, materialId: "screen", recipe: { kind: "device", params: { kind: "monitor" } } },
  { id: "laptop", label: "Laptop", category: "technology", defaultLayer: "technology", size: { w: 1, h: 1 }, collides: false, materialId: "screen", recipe: { kind: "device", params: { kind: "laptop" } } },
  { id: "server-rack", label: "Server Rack", category: "technology", defaultLayer: "technology", size: { w: 1, h: 1 }, collides: true, materialId: "metal-brushed", recipe: { kind: "device", params: { kind: "server" } } },

  // --- Screens / signage ---
  { id: "screen-wall", label: "Wall Screen", category: "screen", defaultLayer: "screens", size: { w: 2, h: 1 }, collides: false, interaction: "openWebsite", materialId: "screen", recipe: { kind: "screen", params: { size: "wall" } } },
  { id: "screen-kiosk", label: "Kiosk", category: "screen", defaultLayer: "screens", size: { w: 1, h: 1 }, collides: true, interaction: "openWebsite", materialId: "screen", recipe: { kind: "screen", params: { size: "kiosk" } } },
  { id: "sign-logo", label: "Company Logo Sign", category: "signage", defaultLayer: "signage", size: { w: 2, h: 1 }, collides: false, materialId: "plastic", recipe: { kind: "sign", params: { kind: "logo" } } },
  { id: "sign-room", label: "Room Sign", category: "signage", defaultLayer: "signage", size: { w: 1, h: 1 }, collides: false, materialId: "plastic", recipe: { kind: "sign", params: { kind: "room" } } },

  // --- Decor ---
  { id: "plant", label: "Plant", category: "decor", defaultLayer: "decor", size: { w: 1, h: 1 }, collides: false, materialId: "cotton", recipe: { kind: "plant", params: {} } },
  { id: "plant-tall", label: "Tall Plant", category: "decor", defaultLayer: "decor", size: { w: 1, h: 2 }, collides: false, materialId: "cotton", recipe: { kind: "plant", params: { tall: true } } },
  { id: "rug", label: "Rug", category: "decor", defaultLayer: "decor", size: { w: 2, h: 2 }, collides: false, materialId: "cotton", recipe: { kind: "rug", params: {} } },
  { id: "art", label: "Wall Art", category: "decor", defaultLayer: "decor", size: { w: 1, h: 1 }, collides: false, materialId: "plastic", recipe: { kind: "art", params: {} } },
  { id: "tree", label: "Tree", category: "exterior", defaultLayer: "exterior", size: { w: 2, h: 2 }, collides: true, materialId: "wood", recipe: { kind: "plant", params: { tree: true } } },

  // --- Zones & markers ---
  { id: "door", label: "Door", category: "wall", defaultLayer: "entrances", size: { w: 1, h: 1 }, collides: false, interaction: "entrance", materialId: "wood", recipe: { kind: "door", params: {} } },
  { id: "spawn", label: "Spawn Point", category: "zone", defaultLayer: "spawns", size: { w: 1, h: 1 }, collides: false, interaction: "spawn", materialId: "plastic", recipe: { kind: "marker", params: { tone: "spawn" } } },
  { id: "exit", label: "Exit", category: "zone", defaultLayer: "exits", size: { w: 1, h: 1 }, collides: false, interaction: "exit", materialId: "plastic", recipe: { kind: "marker", params: { tone: "exit" } } },
  { id: "zone-meeting", label: "Meeting Zone", category: "zone", defaultLayer: "interactions", size: { w: 2, h: 2 }, collides: false, interaction: "meeting", materialId: "plastic", recipe: { kind: "marker", params: { tone: "meeting" } } },
  { id: "zone-silent", label: "Silent Zone", category: "zone", defaultLayer: "interactions", size: { w: 2, h: 2 }, collides: false, interaction: "silent", materialId: "plastic", recipe: { kind: "marker", params: { tone: "silent" } } },
];

export const MAP_ASSET_BY_ID = new Map(MAP_ASSETS.map((a) => [a.id, a]));

export function mapAsset(id: string): MapAssetDef | undefined {
  return MAP_ASSET_BY_ID.get(id);
}
