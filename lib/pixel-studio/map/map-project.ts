/**
 * Map project domain — default/blank projects, floorplan templates, and pure
 * placement/edit operations used by the map editor UI and tests.
 */
import { MAP_LAYERS, type MapLayer, type MapLayerId, type MapProject, type MapTilePlacement } from "../types";
import { mapAsset } from "./map-assets";

const LAYER_LABELS: Record<MapLayerId, string> = {
  exterior: "Exterior",
  ground: "Ground",
  floor: "Floor Finishes",
  walls: "Walls",
  furniture: "Furniture",
  technology: "Technology",
  signage: "Signage & Branding",
  screens: "Screens",
  decor: "Decorative",
  collisions: "Collisions",
  interactions: "Interaction Zones",
  spawns: "Spawn Points",
  entrances: "Entrances",
  exits: "Exits",
  overhead: "Character Overhead",
};

const ISO = "1970-01-01T00:00:00.000Z";

export function emptyLayers(): MapLayer[] {
  return MAP_LAYERS.map((id) => ({
    id,
    label: LAYER_LABELS[id],
    visible: true,
    locked: false,
    placements: [],
  }));
}

export function blankProject(name = "Untitled Office", width = 20, height = 15, timestamp = ISO): MapProject {
  return {
    mapId: `map-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    description: "A FundExecs workspace.",
    schemaVersion: "1.0.0",
    width,
    height,
    tileSize: 32,
    layers: emptyLayers(),
    branding: {
      primaryColor: "#2a3a5c",
      secondaryColor: "#c9a84c",
      companyName: "FundExecs",
    },
    attribution: {
      author: "FundExecs",
      license: "MIT",
      copyright: "© 2026 FundExecs. Original map assets.",
    },
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

export function layer(project: MapProject, id: MapLayerId): MapLayer {
  const l = project.layers.find((x) => x.id === id);
  if (!l) throw new Error(`No layer ${id}`);
  return l;
}

/** Place an asset on its default layer (immutably returns a new project). */
export function placeAsset(
  project: MapProject,
  assetId: string,
  x: number,
  y: number,
  props?: Record<string, string | number | boolean>,
): MapProject {
  const def = mapAsset(assetId);
  if (!def) return project;
  const placement: MapTilePlacement = { assetId, x, y, props };
  const layers = project.layers.map((l) =>
    l.id === def.defaultLayer && !l.locked
      ? { ...l, placements: [...l.placements, placement] }
      : l,
  );
  // Auto-mark collision layer for colliding objects.
  const withCollision = def.collides
    ? layers.map((l) =>
        l.id === "collisions"
          ? { ...l, placements: addCollisionCells(l.placements, def, x, y) }
          : l,
      )
    : layers;
  return { ...project, layers: withCollision };
}

function addCollisionCells(
  existing: MapTilePlacement[],
  def: { size: { w: number; h: number } },
  x: number,
  y: number,
): MapTilePlacement[] {
  const cells = [...existing];
  for (let dy = 0; dy < def.size.h; dy++)
    for (let dx = 0; dx < def.size.w; dx++)
      if (!cells.some((c) => c.x === x + dx && c.y === y + dy))
        cells.push({ assetId: "__collision", x: x + dx, y: y + dy });
  return cells;
}

export function removeAt(project: MapProject, layerId: MapLayerId, x: number, y: number): MapProject {
  return {
    ...project,
    layers: project.layers.map((l) =>
      l.id === layerId ? { ...l, placements: l.placements.filter((p) => !(p.x === x && p.y === y)) } : l,
    ),
  };
}

export function resize(project: MapProject, width: number, height: number): MapProject {
  const clamp = (l: MapLayer): MapLayer => ({
    ...l,
    placements: l.placements.filter((p) => p.x < width && p.y < height),
  });
  return { ...project, width, height, layers: project.layers.map(clamp) };
}

// --- Templates ------------------------------------------------------------

export function templateOpenOffice(): MapProject {
  let p = blankProject("Open Office", 20, 15);
  // Floor fill.
  for (let y = 0; y < 15; y++) for (let x = 0; x < 20; x++) p = placeAsset(p, "floor-carpet", x, y);
  // Perimeter walls.
  for (let x = 0; x < 20; x++) {
    p = placeAsset(p, "wall-solid", x, 0);
    p = placeAsset(p, "wall-solid", x, 14);
  }
  for (let y = 1; y < 14; y++) {
    p = placeAsset(p, "wall-solid", 0, y);
    p = placeAsset(p, "wall-solid", 19, y);
  }
  // Desks pods.
  for (let gx = 3; gx < 17; gx += 6) {
    for (let gy = 3; gy < 12; gy += 4) {
      p = placeAsset(p, "desk", gx, gy);
      p = placeAsset(p, "chair", gx, gy + 1);
      p = placeAsset(p, "monitor", gx, gy);
    }
  }
  p = placeAsset(p, "door", 10, 14);
  p = placeAsset(p, "spawn", 10, 12);
  p = placeAsset(p, "plant", 2, 2);
  p = placeAsset(p, "sign-logo", 8, 1);
  return p;
}

export function templateMeetingRoom(): MapProject {
  let p = blankProject("Meeting Room", 14, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) p = placeAsset(p, "floor-wood", x, y);
  for (let x = 0; x < 14; x++) {
    p = placeAsset(p, "wall-solid", x, 0);
    p = placeAsset(p, "wall-solid", x, 11);
  }
  for (let y = 1; y < 11; y++) {
    p = placeAsset(p, "wall-glass", 0, y);
    p = placeAsset(p, "wall-glass", 13, y);
  }
  p = placeAsset(p, "table-conf", 5, 5);
  for (let cx = 5; cx < 9; cx++) {
    p = placeAsset(p, "chair", cx, 4);
    p = placeAsset(p, "chair", cx, 7);
  }
  p = placeAsset(p, "screen-wall", 6, 1);
  p = placeAsset(p, "zone-meeting", 5, 4);
  p = placeAsset(p, "door", 7, 11);
  p = placeAsset(p, "spawn", 2, 9);
  return p;
}

export function templateReception(): MapProject {
  let p = blankProject("Reception", 16, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) p = placeAsset(p, "floor-marble", x, y);
  for (let x = 0; x < 16; x++) {
    p = placeAsset(p, "wall-solid", x, 0);
    p = placeAsset(p, "wall-window", x, 11);
  }
  p = placeAsset(p, "reception", 6, 3);
  p = placeAsset(p, "sign-logo", 6, 1);
  p = placeAsset(p, "sofa", 2, 8);
  p = placeAsset(p, "sofa", 12, 8);
  p = placeAsset(p, "plant-tall", 1, 2);
  p = placeAsset(p, "plant-tall", 14, 2);
  p = placeAsset(p, "rug", 6, 7);
  p = placeAsset(p, "door", 8, 11);
  p = placeAsset(p, "spawn", 8, 9);
  return p;
}

export const TEMPLATES: { id: string; label: string; build: () => MapProject }[] = [
  { id: "open-office", label: "Open Office", build: templateOpenOffice },
  { id: "meeting-room", label: "Meeting Room", build: templateMeetingRoom },
  { id: "reception", label: "Reception", build: templateReception },
  { id: "blank", label: "Blank Canvas", build: () => blankProject() },
];
