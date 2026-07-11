import {
  FURNITURE_STORAGE_KEY,
  defaultPlacements,
  loadFurniturePlacements,
  nextPieceId,
  parsePlacements,
  resetFurniturePlacements,
  saveFurniturePlacements,
  serializePlacements,
  validatePiece,
  validatePlacements,
  type FurnitureStorage,
} from "./furnitureStore";
import type { PlacedPiece } from "./furniturePlacement";

const VALID: PlacedPiece = { id: "piece-1", roomKey: "ceo", type: "desk", x: 100, y: 120 };

/** In-memory Storage stub — the module runs under jest's `node` environment. */
function memStorage(seed: Record<string, string> = {}): FurnitureStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("validatePiece", () => {
  it("accepts and normalizes a well-formed piece", () => {
    const res = validatePiece({ ...VALID, id: "  piece-1  ", x: 100.4, y: 120.6 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.piece.id).toBe("piece-1"); // trimmed
      expect(res.piece.x).toBe(100); // rounded
      expect(res.piece.y).toBe(121);
    }
  });

  it("rejects an unknown room", () => {
    const res = validatePiece({ ...VALID, roomKey: "nope" });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown furniture type", () => {
    const res = validatePiece({ ...VALID, type: "hovercraft" });
    expect(res.ok).toBe(false);
  });

  it("rejects non-numeric coordinates", () => {
    const res = validatePiece({ ...VALID, x: "left" });
    expect(res.ok).toBe(false);
  });

  it("clamps out-of-range coordinates into the room", () => {
    const res = validatePiece({ ...VALID, x: -50, y: 99999 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.piece.x).toBe(0);
      expect(res.piece.y).toBeLessThanOrEqual(288); // ROOM_H
    }
  });
});

describe("validatePlacements", () => {
  it("rejects a list with duplicate ids", () => {
    const res = validatePlacements([VALID, { ...VALID }]);
    expect(res.ok).toBe(false);
  });

  it("accepts a valid list", () => {
    const res = validatePlacements([VALID, { ...VALID, id: "piece-2", type: "plant" }]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.pieces).toHaveLength(2);
  });
});

describe("parsePlacements", () => {
  it("defaults to empty on null / malformed / invalid JSON", () => {
    expect(parsePlacements(null)).toEqual(defaultPlacements());
    expect(parsePlacements("{not json")).toEqual([]);
    expect(parsePlacements(JSON.stringify([{ id: "x" }]))).toEqual([]);
  });

  it("round-trips a valid list", () => {
    const pieces = [VALID, { ...VALID, id: "piece-2", type: "safe" as const }];
    expect(parsePlacements(serializePlacements(pieces))).toEqual(pieces);
  });
});

describe("load / save / reset", () => {
  it("loads defaults when nothing is stored, then persists a saved list", () => {
    const store = memStorage();
    expect(loadFurniturePlacements(store)).toEqual([]);
    const res = saveFurniturePlacements([VALID], store);
    expect(res.ok).toBe(true);
    expect(loadFurniturePlacements(store)).toEqual([VALID]);
  });

  it("does not persist an invalid list", () => {
    const store = memStorage();
    const res = saveFurniturePlacements([{ ...VALID, roomKey: "nope" }], store);
    expect(res.ok).toBe(false);
    expect(store.getItem(FURNITURE_STORAGE_KEY)).toBeNull();
  });

  it("reset clears the persisted list", () => {
    const store = memStorage();
    saveFurniturePlacements([VALID], store);
    resetFurniturePlacements(store);
    expect(loadFurniturePlacements(store)).toEqual([]);
  });
});

describe("nextPieceId", () => {
  it("allocates a non-colliding id", () => {
    expect(nextPieceId([])).toBe("piece-1");
    expect(nextPieceId([VALID])).not.toBe("piece-1");
  });
});
