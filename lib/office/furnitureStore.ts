/**
 * FundExecs OS — furniture-placement store (persistence + validation).
 *
 * Mirrors `areaStore.ts`: a pure, framework-free core (validate / (de)serialise /
 * parse) that unit-tests in Node, plus load/save/reset helpers that take an
 * injectable `Storage` (tests pass a stub; the browser uses `localStorage`).
 * Saving emits a window event the Phaser scene reacts to for a live re-render.
 */
import { ROOMS, ROOM_W, ROOM_H } from "@/components/virtual-office/types";
import { PIECE_TYPES, type PieceType } from "./furnitureTypes";
import { DEFAULT_PLACEMENTS, type PlacedPiece } from "./furniturePlacement";

/** localStorage key the placed-furniture list is persisted under. */
export const FURNITURE_STORAGE_KEY = "office:furniture-placements";

/** Window event emitted after a save, so the scene can re-render live. */
export const FURNITURE_STORE_EVENT = "office:furniture-changed";

/** Minimal storage surface — `window.localStorage` satisfies it, as does a stub. */
export type FurnitureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ROOM_KEYS = new Set(ROOMS.map((r) => r.key));

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Validate a single raw piece, normalizing + clamping coords. Pure. */
export function validatePiece(raw: unknown): { ok: true; piece: PlacedPiece } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Piece must be an object." };
  const p = raw as Record<string, unknown>;

  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) return { ok: false, error: "Piece id is required." };

  if (typeof p.roomKey !== "string" || !ROOM_KEYS.has(p.roomKey)) return { ok: false, error: "Unknown room." };
  if (!PIECE_TYPES.includes(p.type as PieceType)) return { ok: false, error: "Unknown furniture type." };
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return { ok: false, error: "x and y must be numbers." };

  const piece: PlacedPiece = {
    id,
    roomKey: p.roomKey,
    type: p.type as PieceType,
    x: clamp(Math.round(p.x), 0, ROOM_W),
    y: clamp(Math.round(p.y), 0, ROOM_H),
  };
  return { ok: true, piece };
}

/** Validate a whole list: each entry valid and ids unique. Pure. */
export function validatePlacements(raw: unknown): { ok: true; pieces: PlacedPiece[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Expected a list of pieces." };
  const pieces: PlacedPiece[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const res = validatePiece(entry);
    if (!res.ok) return res;
    if (seen.has(res.piece.id)) return { ok: false, error: `Duplicate piece id "${res.piece.id}".` };
    seen.add(res.piece.id);
    pieces.push(res.piece);
  }
  return { ok: true, pieces };
}

/** Serialize a placement list to the persisted JSON string. Pure. */
export function serializePlacements(pieces: PlacedPiece[]): string {
  return JSON.stringify(pieces);
}

/** A fresh copy of the (empty) built-in seed. */
export function defaultPlacements(): PlacedPiece[] {
  return DEFAULT_PLACEMENTS.map((p) => ({ ...p }));
}

/**
 * Parse a persisted JSON string into a valid list, falling back to the empty
 * default when missing / malformed / invalid. Pure and null-safe.
 */
export function parsePlacements(json: string | null): PlacedPiece[] {
  if (!json) return defaultPlacements();
  try {
    const parsed = JSON.parse(json);
    const res = validatePlacements(parsed);
    return res.ok ? res.pieces : defaultPlacements();
  } catch {
    return defaultPlacements();
  }
}

function resolveStorage(storage?: FurnitureStorage): FurnitureStorage | null {
  if (storage) return storage;
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* access can throw in privacy modes */
  }
  return null;
}

/** Load the persisted placements, defaulting to empty. Never throws / SSR-safe. */
export function loadFurniturePlacements(storage?: FurnitureStorage): PlacedPiece[] {
  const store = resolveStorage(storage);
  if (!store) return defaultPlacements();
  try {
    return parsePlacements(store.getItem(FURNITURE_STORAGE_KEY));
  } catch {
    return defaultPlacements();
  }
}

/**
 * Persist a placement list (validating first) and notify listeners so the live
 * floor re-renders. Returns the validation result.
 */
export function saveFurniturePlacements(
  pieces: PlacedPiece[],
  storage?: FurnitureStorage,
): { ok: true; pieces: PlacedPiece[] } | { ok: false; error: string } {
  const res = validatePlacements(pieces);
  if (!res.ok) return res;
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(FURNITURE_STORAGE_KEY, serializePlacements(res.pieces));
    } catch {
      /* quota / privacy mode — keep the in-memory set */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FURNITURE_STORE_EVENT, { detail: res.pieces }));
  }
  return res;
}

/** Clear the persisted placements so the floor reverts to the built-in LAYOUT. */
export function resetFurniturePlacements(storage?: FurnitureStorage): PlacedPiece[] {
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.removeItem(FURNITURE_STORAGE_KEY);
    } catch {
      /* no-op */
    }
  }
  const pieces = defaultPlacements();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FURNITURE_STORE_EVENT, { detail: pieces }));
  }
  return pieces;
}

/** Allocate a piece id that doesn't collide with the current list. */
export function nextPieceId(pieces: PlacedPiece[]): string {
  const used = new Set(pieces.map((p) => p.id));
  for (let i = pieces.length + 1; ; i++) {
    const id = `piece-${i}`;
    if (!used.has(id)) return id;
  }
}
