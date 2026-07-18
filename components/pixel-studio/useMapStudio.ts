"use client";

/**
 * Map Studio state hook — project document, undo/redo, current tool + selected
 * asset, view state (grid/zoom/PBR), and localStorage-backed project storage
 * and autosave.
 */
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { toTiled, fromTiled, type TiledMap } from "@/lib/pixel-studio/adapters/tiled";
import {
  blankProject,
  placeAsset,
  removeAt,
  resize,
  TEMPLATES,
} from "@/lib/pixel-studio/map/map-project";
import type { MapLayerId, MapProject } from "@/lib/pixel-studio/types";

const LS_PROJECTS = "pixel-studio:maps";
const LS_AUTOSAVE = "pixel-studio:map-autosave";
const HISTORY_MAX = 40;

export type MapTool = "place" | "erase" | "select";

export interface SavedMap {
  id: string;
  name: string;
  project: MapProject;
  savedAt: string;
}

interface State {
  project: MapProject;
  past: MapProject[];
  future: MapProject[];
  tool: MapTool;
  selectedAsset: string;
  showGrid: boolean;
  zoom: number;
  viewMode: "pixel" | "pbr";
  saved: SavedMap[];
}

type Action =
  | { type: "commit"; project: MapProject }
  | { type: "hydrate"; project: MapProject }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "tool"; tool: MapTool }
  | { type: "select"; asset: string }
  | { type: "grid" }
  | { type: "zoom"; zoom: number }
  | { type: "view"; mode: "pixel" | "pbr" }
  | { type: "saved"; saved: SavedMap[] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "commit":
      return { ...state, past: [...state.past, state.project].slice(-HISTORY_MAX), future: [], project: action.project };
    case "hydrate":
      return { ...state, project: action.project, past: [], future: [] };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, project: next, past: [...state.past, state.project], future: state.future.slice(1) };
    }
    case "tool":
      return { ...state, tool: action.tool };
    case "select":
      return { ...state, selectedAsset: action.asset, tool: "place" };
    case "grid":
      return { ...state, showGrid: !state.showGrid };
    case "zoom":
      return { ...state, zoom: action.zoom };
    case "view":
      return { ...state, viewMode: action.mode };
    case "saved":
      return { ...state, saved: action.saved };
    default:
      return state;
  }
}

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

export function useMapStudio(initial?: MapProject) {
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    (): State => ({
      project: initial ?? TEMPLATES[0].build(),
      past: [],
      future: [],
      tool: "place",
      selectedAsset: "desk",
      showGrid: true,
      zoom: 16,
      viewMode: "pixel",
      saved: [],
    }),
  );

  useEffect(() => {
    dispatch({ type: "saved", saved: readLS<SavedMap[]>(LS_PROJECTS, []) });
    if (!initial) {
      const auto = readLS<MapProject | null>(LS_AUTOSAVE, null);
      if (auto && auto.mapId) dispatch({ type: "hydrate", project: auto });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeLS(LS_AUTOSAVE, state.project);
  }, [state.project]);

  const actions = useMemo(
    () => ({
      place: (x: number, y: number) => dispatch({ type: "commit", project: placeAsset(state.project, state.selectedAsset, x, y) }),
      eraseCell: (x: number, y: number) => {
        let p = state.project;
        for (const layer of [...p.layers].reverse()) {
          if (layer.locked) continue;
          if (layer.placements.some((pl) => pl.x === x && pl.y === y)) {
            p = removeAt(p, layer.id, x, y);
            break;
          }
        }
        if (p !== state.project) dispatch({ type: "commit", project: p });
      },
      newFromTemplate: (id: string) => {
        const tpl = TEMPLATES.find((t) => t.id === id);
        if (tpl) dispatch({ type: "hydrate", project: tpl.build() });
      },
      newBlank: (w: number, h: number) => dispatch({ type: "hydrate", project: blankProject("Untitled Office", w, h) }),
      resizeMap: (w: number, h: number) => dispatch({ type: "commit", project: resize(state.project, w, h) }),
      setBranding: (patch: Partial<MapProject["branding"]>) => dispatch({ type: "commit", project: { ...state.project, branding: { ...state.project.branding, ...patch } } }),
      setMeta: (patch: Partial<Pick<MapProject, "name" | "description">>) => dispatch({ type: "commit", project: { ...state.project, ...patch } }),
      toggleLayerVisible: (id: MapLayerId) => dispatch({ type: "commit", project: { ...state.project, layers: state.project.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) } }),
      toggleLayerLocked: (id: MapLayerId) => dispatch({ type: "commit", project: { ...state.project, layers: state.project.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)) } }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      setTool: (tool: MapTool) => dispatch({ type: "tool", tool }),
      select: (asset: string) => dispatch({ type: "select", asset }),
      toggleGrid: () => dispatch({ type: "grid" }),
      setZoom: (zoom: number) => dispatch({ type: "zoom", zoom }),
      setView: (mode: "pixel" | "pbr") => dispatch({ type: "view", mode }),
      save: (name: string) => {
        const item: SavedMap = { id: `map-${Date.now()}`, name, project: { ...state.project, name }, savedAt: new Date().toISOString() };
        const saved = [item, ...state.saved.filter((s) => s.name !== name)];
        writeLS(LS_PROJECTS, saved);
        dispatch({ type: "saved", saved });
      },
      load: (m: SavedMap) => dispatch({ type: "hydrate", project: m.project }),
      remove: (id: string) => {
        const saved = state.saved.filter((s) => s.id !== id);
        writeLS(LS_PROJECTS, saved);
        dispatch({ type: "saved", saved });
      },
      exportTiledJson: (): string => JSON.stringify(toTiled(state.project), null, 2),
      importTiledJson: (json: string): { ok: boolean; error?: string } => {
        try {
          const map = JSON.parse(json) as TiledMap;
          if (!map.layers || map.type !== "map") throw new Error("Not a Tiled map (missing type/layers)");
          dispatch({ type: "hydrate", project: fromTiled(map) });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "Invalid Tiled JSON" };
        }
      },
    }),
    [state.project, state.selectedAsset, state.saved],
  );

  return { state, actions };
}
