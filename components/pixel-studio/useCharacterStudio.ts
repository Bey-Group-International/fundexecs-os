"use client";

/**
 * Character Studio state hook — a self-contained reducer store (the repo does
 * not ship Zustand; this mirrors the store discipline used elsewhere). Owns the
 * working config, undo/redo history, category locks, playback + view state,
 * saved presets, autosave, and export history. Persistence is localStorage and
 * stores only non-sensitive asset/palette ids.
 */
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { getRegistry } from "@/lib/pixel-studio/browser-runtime";
import {
  defaultConfig,
  newCharacterId,
  parseConfig,
  randomize,
  serializeConfig,
  type RandomizableCategory,
} from "@/lib/pixel-studio/character";
import { migrateConfig } from "@/lib/pixel-studio/character";
import { getManifest } from "@/lib/pixel-studio/manifest";
import type { AnimationState, CharacterConfig, Direction } from "@/lib/pixel-studio/types";

const LS_SAVED = "pixel-studio:characters";
const LS_AUTOSAVE = "pixel-studio:autosave";
const LS_EXPORTS = "pixel-studio:exports";
const HISTORY_MAX = 50;

export type ViewMode = "pixel" | "pbr";

export interface SavedPreset {
  id: string;
  name: string;
  config: CharacterConfig;
  savedAt: string;
}
export interface ExportRecord {
  id: string;
  kind: string;
  name: string;
  at: string;
}

interface State {
  config: CharacterConfig;
  past: CharacterConfig[];
  future: CharacterConfig[];
  direction: Direction;
  animState: AnimationState;
  playing: boolean;
  speed: number;
  viewMode: ViewMode;
  zoom: number;
  locks: RandomizableCategory[];
  lightIntensity: number;
  lightAngle: number;
  saved: SavedPreset[];
  exportHistory: ExportRecord[];
}

type Action =
  | { type: "commit"; config: CharacterConfig }
  | { type: "patch"; patch: Partial<CharacterConfig> }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" }
  | { type: "toggleLock"; cat: RandomizableCategory }
  | { type: "setDirection"; dir: Direction }
  | { type: "setAnimState"; state: AnimationState }
  | { type: "setPlaying"; playing: boolean }
  | { type: "setSpeed"; speed: number }
  | { type: "setViewMode"; mode: ViewMode }
  | { type: "setZoom"; zoom: number }
  | { type: "setLight"; intensity?: number; angle?: number }
  | { type: "setSaved"; saved: SavedPreset[] }
  | { type: "setExports"; exports: ExportRecord[] }
  | { type: "hydrate"; config: CharacterConfig };

function withHistory(state: State, next: CharacterConfig): State {
  const stamped = { ...next, modifiedAt: next.modifiedAt };
  return {
    ...state,
    past: [...state.past, state.config].slice(-HISTORY_MAX),
    future: [],
    config: stamped,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "commit":
      return withHistory(state, action.config);
    case "patch":
      return withHistory(state, { ...state.config, ...action.patch });
    case "hydrate":
      return { ...state, config: action.config, past: [], future: [] };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, config: prev, past: state.past.slice(0, -1), future: [state.config, ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, config: next, past: [...state.past, state.config], future: state.future.slice(1) };
    }
    case "reset":
      return withHistory(state, { ...defaultConfig(getManifest()), displayName: state.config.displayName, characterId: state.config.characterId });
    case "toggleLock": {
      const has = state.locks.includes(action.cat);
      return { ...state, locks: has ? state.locks.filter((c) => c !== action.cat) : [...state.locks, action.cat] };
    }
    case "setDirection":
      return { ...state, direction: action.dir, config: { ...state.config, direction: action.dir } };
    case "setAnimState":
      return { ...state, animState: action.state, playing: true, config: { ...state.config, state: action.state } };
    case "setPlaying":
      return { ...state, playing: action.playing };
    case "setSpeed":
      return { ...state, speed: action.speed };
    case "setViewMode":
      return { ...state, viewMode: action.mode };
    case "setZoom":
      return { ...state, zoom: action.zoom };
    case "setLight":
      return {
        ...state,
        lightIntensity: action.intensity ?? state.lightIntensity,
        lightAngle: action.angle ?? state.lightAngle,
      };
    case "setSaved":
      return { ...state, saved: action.saved };
    case "setExports":
      return { ...state, exportHistory: action.exports };
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
    /* quota / privacy mode — non-fatal */
  }
}

export function useCharacterStudio(initial?: CharacterConfig) {
  const registry = getRegistry();
  const manifest = getManifest();

  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    (): State => ({
      config: initial ?? defaultConfig(manifest),
      past: [],
      future: [],
      direction: "down",
      animState: "idle",
      playing: true,
      speed: 1,
      viewMode: "pixel",
      zoom: 8,
      locks: [],
      lightIntensity: 1.1,
      lightAngle: 135,
      saved: [],
      exportHistory: [],
    }),
  );

  // Hydrate persisted state after mount (avoids SSR mismatch).
  useEffect(() => {
    const saved = readLS<SavedPreset[]>(LS_SAVED, []);
    const exportsH = readLS<ExportRecord[]>(LS_EXPORTS, []);
    dispatch({ type: "setSaved", saved });
    dispatch({ type: "setExports", exports: exportsH });
    if (!initial) {
      const auto = readLS<CharacterConfig | null>(LS_AUTOSAVE, null);
      if (auto && auto.characterId) {
        const migrated = migrateConfig(registry, auto);
        dispatch({ type: "hydrate", config: migrated.config });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave working config.
  useEffect(() => {
    writeLS(LS_AUTOSAVE, state.config);
  }, [state.config]);

  const actions = useMemo(
    () => ({
      patch: (patch: Partial<CharacterConfig>) => dispatch({ type: "patch", patch }),
      commit: (config: CharacterConfig) => dispatch({ type: "commit", config }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      reset: () => dispatch({ type: "reset" }),
      toggleLock: (cat: RandomizableCategory) => dispatch({ type: "toggleLock", cat }),
      setDirection: (dir: Direction) => dispatch({ type: "setDirection", dir }),
      setAnimState: (s: AnimationState) => dispatch({ type: "setAnimState", state: s }),
      setPlaying: (p: boolean) => dispatch({ type: "setPlaying", playing: p }),
      setSpeed: (s: number) => dispatch({ type: "setSpeed", speed: s }),
      setViewMode: (m: ViewMode) => dispatch({ type: "setViewMode", mode: m }),
      setZoom: (z: number) => dispatch({ type: "setZoom", zoom: z }),
      setLight: (intensity?: number, angle?: number) => dispatch({ type: "setLight", intensity, angle }),
      randomizeAll: (seed: number) => {
        const cfg = randomize(registry, state.config, seed, new Set(state.locks));
        dispatch({ type: "commit", config: { ...cfg, displayName: state.config.displayName, characterId: state.config.characterId } });
      },
      randomizeCategory: (cat: RandomizableCategory, seed: number) => {
        const allButOne = new Set(
          (["skin", "face", "expression", "hair", "hairColor", "facialHair", "headCovering", "outfit", "accessory"] as RandomizableCategory[]).filter(
            (c) => c !== cat,
          ),
        );
        const cfg = randomize(registry, state.config, seed, allButOne);
        dispatch({ type: "commit", config: { ...cfg, displayName: state.config.displayName, characterId: state.config.characterId } });
      },
      save: (name: string) => {
        const preset: SavedPreset = {
          id: newCharacterId(name + Date.now()),
          name,
          config: { ...state.config, displayName: name },
          savedAt: new Date().toISOString(),
        };
        const saved = [preset, ...state.saved.filter((s) => s.name !== name)];
        writeLS(LS_SAVED, saved);
        dispatch({ type: "setSaved", saved });
      },
      duplicate: () => {
        const copy: CharacterConfig = {
          ...state.config,
          characterId: newCharacterId(state.config.characterId + "-copy" + Date.now()),
          displayName: `${state.config.displayName} Copy`,
        };
        dispatch({ type: "commit", config: copy });
      },
      deletePreset: (id: string) => {
        const saved = state.saved.filter((s) => s.id !== id);
        writeLS(LS_SAVED, saved);
        dispatch({ type: "setSaved", saved });
      },
      load: (preset: SavedPreset) => {
        const migrated = migrateConfig(registry, preset.config);
        dispatch({ type: "commit", config: migrated.config });
      },
      importJson: (json: string): { ok: boolean; error?: string } => {
        try {
          const parsed = parseConfig(json);
          const migrated = migrateConfig(registry, parsed);
          dispatch({ type: "commit", config: migrated.config });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "Invalid configuration" };
        }
      },
      exportJson: (): string => serializeConfig(state.config),
      recordExport: (kind: string, name: string) => {
        const rec: ExportRecord = { id: newCharacterId(kind + Date.now()), kind, name, at: new Date().toISOString() };
        const exportsH = [rec, ...state.exportHistory].slice(0, 30);
        writeLS(LS_EXPORTS, exportsH);
        dispatch({ type: "setExports", exports: exportsH });
      },
    }),
    [registry, state.config, state.locks, state.saved, state.exportHistory],
  );

  const compatibilityIssues = useMemo(() => registry.validateConfig(state.config), [registry, state.config]);

  return { state, actions, registry, manifest, compatibilityIssues };
}
