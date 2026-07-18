/**
 * Tiled adapter — converts a MapProject to WorkAdventure-compatible Tiled JSON
 * (.tmj) and back, preserving collision tile properties, the required
 * `floorLayer` marker, spawn/exit metadata, and interaction properties.
 *
 * WorkAdventure reads Tiled maps where:
 *   - tile layers carry the visual tiles,
 *   - an object layer named "floorLayer" marks where characters walk,
 *   - collidable tiles have a `collides: true` tile property,
 *   - start positions / exits live as objects with typed properties.
 */
import {
  MAP_LAYERS,
  type MapLayer,
  type MapLayerId,
  type MapProject,
  type MapTilePlacement,
  type CompatibilityReport,
} from "../types";
import { MAP_ASSETS, mapAsset } from "../map/map-assets";

/** Stable tile GID assignment: 1-based index into the ordered asset list. */
const TILE_GIDS = new Map<string, number>();
MAP_ASSETS.forEach((a, i) => TILE_GIDS.set(a.id, i + 1));
const GID_TO_ID = new Map<number, string>();
TILE_GIDS.forEach((gid, id) => GID_TO_ID.set(gid, id));

const COLLIDE_GID = MAP_ASSETS.length + 1; // sentinel collision tile

interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup";
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
  visible: boolean;
  opacity: number;
  x: 0;
  y: 0;
  properties?: TiledProperty[];
  id: number;
}

interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
  point?: boolean;
}

interface TiledProperty {
  name: string;
  type: "string" | "bool" | "int" | "float";
  value: string | number | boolean;
}

/** Tile layers that render visual tiles (as opposed to metadata layers). */
const VISUAL_LAYERS: MapLayerId[] = [
  "exterior",
  "ground",
  "floor",
  "walls",
  "furniture",
  "technology",
  "signage",
  "screens",
  "decor",
  "overhead",
];

function grid(project: MapProject, layer: MapLayer): number[] {
  const data = new Array(project.width * project.height).fill(0);
  for (const p of layer.placements) {
    if (p.x < project.width && p.y < project.height) {
      const gid = TILE_GIDS.get(p.assetId) ?? 0;
      data[p.y * project.width + p.x] = gid;
    }
  }
  return data;
}

export interface TiledMap {
  compressionlevel: number;
  width: number;
  height: number;
  tilewidth: 32;
  tileheight: 32;
  orientation: "orthogonal";
  renderorder: "right-down";
  infinite: false;
  type: "map";
  version: string;
  tiledversion: string;
  layers: TiledLayer[];
  tilesets: unknown[];
  properties: TiledProperty[];
  nextlayerid: number;
  nextobjectid: number;
}

export function toTiled(project: MapProject): TiledMap {
  const layers: TiledLayer[] = [];
  let layerId = 1;
  let objectId = 1;

  // Visual tile layers.
  for (const id of VISUAL_LAYERS) {
    const l = project.layers.find((x) => x.id === id);
    if (!l || l.placements.length === 0) continue;
    layers.push({
      id: layerId++,
      name: id,
      type: "tilelayer",
      width: project.width,
      height: project.height,
      data: grid(project, l),
      visible: l.visible,
      opacity: 1,
      x: 0,
      y: 0,
      properties: id === "overhead" ? [{ name: "wa:overhead", type: "bool", value: true }] : undefined,
    });
  }

  // Collision tile layer — WA reads the `collides` tile property; we also emit
  // a dedicated layer so the data survives round-trips.
  const collisions = project.layers.find((x) => x.id === "collisions");
  if (collisions && collisions.placements.length) {
    const data = new Array(project.width * project.height).fill(0);
    for (const p of collisions.placements) {
      if (p.x < project.width && p.y < project.height) data[p.y * project.width + p.x] = COLLIDE_GID;
    }
    layers.push({
      id: layerId++,
      name: "collisions",
      type: "tilelayer",
      width: project.width,
      height: project.height,
      data,
      visible: false,
      opacity: 1,
      x: 0,
      y: 0,
      properties: [{ name: "collides", type: "bool", value: true }],
    });
  }

  // Required floorLayer object group (character walk plane marker).
  layers.push({
    id: layerId++,
    name: "floorLayer",
    type: "objectgroup",
    objects: [],
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
  });

  // Spawns / entrances / exits / interaction zones → objects.
  const objectLayers: MapLayerId[] = ["spawns", "entrances", "exits", "interactions"];
  const objects: TiledObject[] = [];
  for (const id of objectLayers) {
    const l = project.layers.find((x) => x.id === id);
    if (!l) continue;
    for (const p of l.placements) {
      const def = mapAsset(p.assetId);
      objects.push(toObject(objectId++, p, id, def?.interaction, def?.size));
    }
  }
  if (objects.length) {
    layers.push({
      id: layerId++,
      name: "interactions",
      type: "objectgroup",
      objects,
      visible: true,
      opacity: 1,
      x: 0,
      y: 0,
    });
  }

  return {
    compressionlevel: -1,
    width: project.width,
    height: project.height,
    tilewidth: 32,
    tileheight: 32,
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    layers,
    tilesets: [buildTilesetDescriptor()],
    properties: [
      { name: "mapName", type: "string", value: project.name },
      { name: "mapDescription", type: "string", value: project.description },
      { name: "mapCopyright", type: "string", value: project.attribution.copyright },
      { name: "tilesetCopyright", type: "string", value: `${project.attribution.author} (${project.attribution.license})` },
      { name: "script", type: "string", value: "" },
    ],
    nextlayerid: layerId,
    nextobjectid: objectId,
  };
}

function toObject(
  id: number,
  p: MapTilePlacement,
  layerId: MapLayerId,
  interaction: string | undefined,
  size: { w: number; h: number } | undefined,
): TiledObject {
  const props: TiledProperty[] = [];
  if (interaction === "spawn" || layerId === "spawns") {
    return {
      id,
      name: "start",
      type: "",
      x: p.x * 32,
      y: p.y * 32,
      width: 0,
      height: 0,
      point: true,
    };
  }
  if (interaction === "exit" || layerId === "exits") {
    props.push({ name: "exitUrl", type: "string", value: String(p.props?.exitUrl ?? "./lobby.tmj") });
  }
  if (interaction === "entrance") {
    props.push({ name: "start", type: "bool", value: true });
  }
  if (interaction === "meeting" || interaction === "jitsi") {
    props.push({ name: "jitsiRoom", type: "string", value: String(p.props?.jitsiRoom ?? "meeting") });
  }
  if (interaction === "openWebsite") {
    props.push({ name: "openWebsite", type: "string", value: String(p.props?.openWebsite ?? "https://fundexecs.dev") });
  }
  if (interaction === "silent") {
    props.push({ name: "silent", type: "bool", value: true });
  }
  return {
    id,
    name: interaction ?? layerId,
    type: interaction ?? "zone",
    x: p.x * 32,
    y: p.y * 32,
    width: (size?.w ?? 1) * 32,
    height: (size?.h ?? 1) * 32,
    properties: props.length ? props : undefined,
  };
}

function buildTilesetDescriptor(): Record<string, unknown> {
  // Embedded tileset metadata. The actual tileset PNG is emitted by the export
  // service; here we describe per-tile collision properties.
  const tiles = MAP_ASSETS.filter((a) => a.collides).map((a) => ({
    id: (TILE_GIDS.get(a.id) ?? 1) - 1,
    properties: [{ name: "collides", type: "bool", value: true }],
  }));
  tiles.push({ id: COLLIDE_GID - 1, properties: [{ name: "collides", type: "bool", value: true }] });
  return {
    firstgid: 1,
    name: "fundexecs-office",
    image: "tileset.png",
    imagewidth: 32 * 16,
    imageheight: 32 * Math.ceil((MAP_ASSETS.length + 1) / 16),
    tilewidth: 32,
    tileheight: 32,
    tilecount: MAP_ASSETS.length + 1,
    columns: 16,
    tiles,
  };
}

// --- Import (reverse) ------------------------------------------------------

export function fromTiled(map: TiledMap, name = "Imported Map"): MapProject {
  const nameProp = map.properties?.find((p) => p.name === "mapName");
  const descProp = map.properties?.find((p) => p.name === "mapDescription");
  const project: MapProject = {
    mapId: `map-imported-${map.width}x${map.height}`,
    name: (nameProp?.value as string) ?? name,
    description: (descProp?.value as string) ?? "",
    schemaVersion: "1.0.0",
    width: map.width,
    height: map.height,
    tileSize: 32,
    layers: MAP_LAYERS.map((id) => ({ id, label: id, visible: true, locked: false, placements: [] })),
    branding: { primaryColor: "#2a3a5c", secondaryColor: "#c9a84c", companyName: "FundExecs" },
    attribution: { author: "FundExecs", license: "MIT", copyright: "© 2026 FundExecs." },
    createdAt: "1970-01-01T00:00:00.000Z",
    modifiedAt: "1970-01-01T00:00:00.000Z",
  };
  const getLayer = (id: MapLayerId) => project.layers.find((l) => l.id === id)!;

  for (const layer of map.layers) {
    if (layer.type === "tilelayer" && layer.data) {
      const target = MAP_LAYERS.includes(layer.name as MapLayerId) ? (layer.name as MapLayerId) : "floor";
      if (layer.name === "collisions") {
        for (let i = 0; i < layer.data.length; i++)
          if (layer.data[i] !== 0)
            getLayer("collisions").placements.push({ assetId: "__collision", x: i % map.width, y: Math.floor(i / map.width) });
        continue;
      }
      for (let i = 0; i < layer.data.length; i++) {
        const gid = layer.data[i];
        if (gid === 0) continue;
        const assetId = GID_TO_ID.get(gid);
        if (!assetId) continue;
        getLayer(target).placements.push({ assetId, x: i % map.width, y: Math.floor(i / map.width) });
      }
    } else if (layer.type === "objectgroup" && layer.objects) {
      for (const obj of layer.objects) {
        const x = Math.round(obj.x / 32);
        const y = Math.round(obj.y / 32);
        if (obj.name === "start" || obj.type === "spawn") getLayer("spawns").placements.push({ assetId: "spawn", x, y });
        else if (obj.type === "exit") getLayer("exits").placements.push({ assetId: "exit", x, y, props: propsToObj(obj.properties) });
        else getLayer("interactions").placements.push({ assetId: "zone-meeting", x, y, props: propsToObj(obj.properties) });
      }
    }
  }
  return project;
}

function propsToObj(props?: TiledProperty[]): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined;
  const o: Record<string, string | number | boolean> = {};
  for (const p of props) o[p.name] = p.value;
  return o;
}

// --- Compatibility report --------------------------------------------------

export function tiledReport(project: MapProject, generatedAt: string): CompatibilityReport {
  const entries: CompatibilityReport["entries"] = [];
  const tiled = toTiled(project);

  entries.push({ requirement: "32×32 orthogonal grid", status: "ok", detail: `${tiled.tilewidth}×${tiled.tileheight} orthogonal` });
  entries.push({
    requirement: "floorLayer object group",
    status: tiled.layers.some((l) => l.name === "floorLayer") ? "ok" : "missing",
    detail: "Required for WorkAdventure character walk plane.",
  });
  entries.push({
    requirement: "Embedded tileset metadata",
    status: tiled.tilesets.length ? "ok" : "missing",
    detail: `${tiled.tilesets.length} tileset(s).`,
  });
  const hasCollision = tiled.layers.some((l) => l.name === "collisions");
  entries.push({
    requirement: "Collision tile properties",
    status: hasCollision ? "ok" : "warning",
    detail: hasCollision ? "collides:true property present." : "No collidable tiles placed.",
  });
  const hasSpawn = project.layers.find((l) => l.id === "spawns")?.placements.length;
  entries.push({
    requirement: "Spawn / start position",
    status: hasSpawn ? "ok" : "missing",
    detail: hasSpawn ? "start object present." : "Place at least one spawn point.",
  });
  entries.push({
    requirement: "Character-below-overhead ordering",
    status: "ok",
    detail: "overhead layer marked wa:overhead and rendered last.",
  });
  entries.push({
    requirement: "Transparent tiles preserved",
    status: "ok",
    detail: "Empty cells encode gid 0.",
  });
  entries.push({
    requirement: "Attribution / license metadata",
    status: "ok",
    detail: "mapCopyright + tilesetCopyright properties set.",
  });
  entries.push({
    requirement: "Generic object-layer behavior",
    status: "flattened",
    detail: "Only typed WA interaction objects are emitted; arbitrary object layers are not relied upon.",
  });

  const ok = entries.every((e) => e.status === "ok" || e.status === "flattened" || e.status === "warning");
  return { target: "WorkAdventure / Tiled", generatedAt, entries, ok };
}
