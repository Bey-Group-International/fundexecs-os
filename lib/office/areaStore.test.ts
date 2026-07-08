import {
  AREA_STORAGE_KEY,
  defaultAreas,
  loadScriptedAreas,
  parseAreas,
  resetScriptedAreas,
  saveScriptedAreas,
  serializeAreas,
  validateArea,
  validateAreas,
  type AreaStorage,
} from "./areaStore";
import { SCRIPTED_AREAS, type ScriptedArea } from "./scriptedAreas";

const VALID: ScriptedArea = {
  id: "lounge",
  label: "Lounge",
  x: 10,
  y: 20,
  w: 100,
  h: 60,
  trigger: { kind: "toast", text: "Welcome to the lounge" },
};

/** In-memory Storage stub — the module runs under jest's `node` environment. */
function memStorage(seed: Record<string, string> = {}): AreaStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("validateArea", () => {
  it("accepts and normalizes a well-formed area", () => {
    const res = validateArea({ ...VALID, id: "  lounge  ", label: "  Lounge  " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.area.id).toBe("lounge"); // trimmed
      expect(res.area.label).toBe("Lounge");
      expect(res.area.trigger).toEqual({ kind: "toast", text: "Welcome to the lounge" });
    }
  });

  it("rejects missing id and label", () => {
    expect(validateArea({ ...VALID, id: "  " }).ok).toBe(false);
    expect(validateArea({ ...VALID, label: "" }).ok).toBe(false);
  });

  it("rejects non-positive or non-finite geometry", () => {
    expect(validateArea({ ...VALID, w: 0 }).ok).toBe(false);
    expect(validateArea({ ...VALID, h: -5 }).ok).toBe(false);
    expect(validateArea({ ...VALID, x: Number.NaN }).ok).toBe(false);
  });

  it("requires text for say/toast but not for start-meeting", () => {
    expect(validateArea({ ...VALID, trigger: { kind: "say", text: "" } }).ok).toBe(false);
    expect(validateArea({ ...VALID, trigger: { kind: "start-meeting" } }).ok).toBe(true);
    expect(validateArea({ ...VALID, trigger: { kind: "bogus" } }).ok).toBe(false);
  });

  it("keeps a valid hex accent and drops a bad one", () => {
    const good = validateArea({ ...VALID, accent: "#abcdef" });
    expect(good.ok && good.area.accent).toBe("#abcdef");
    const bad = validateArea({ ...VALID, accent: "red" });
    expect(bad.ok && bad.area.accent).toBeUndefined();
  });
});

describe("validateAreas", () => {
  it("rejects duplicate ids", () => {
    const res = validateAreas([VALID, { ...VALID }]);
    expect(res.ok).toBe(false);
  });

  it("accepts a unique set", () => {
    const res = validateAreas([VALID, { ...VALID, id: "second" }]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.areas).toHaveLength(2);
  });

  it("rejects a non-array", () => {
    expect(validateAreas({} as unknown).ok).toBe(false);
  });
});

describe("parseAreas / serializeAreas", () => {
  it("round-trips a valid set", () => {
    const json = serializeAreas([VALID]);
    expect(parseAreas(json)).toEqual([VALID]);
  });

  it("falls back to defaults on null, malformed, or invalid JSON", () => {
    expect(parseAreas(null)).toEqual(SCRIPTED_AREAS);
    expect(parseAreas("{not json")).toEqual(SCRIPTED_AREAS);
    expect(parseAreas(JSON.stringify([{ id: "x" }]))).toEqual(SCRIPTED_AREAS);
  });

  it("defaults are a deep copy, not the shared reference", () => {
    const a = defaultAreas();
    expect(a).toEqual(SCRIPTED_AREAS);
    expect(a[0]).not.toBe(SCRIPTED_AREAS[0]);
    expect(a[0].trigger).not.toBe(SCRIPTED_AREAS[0].trigger);
  });
});

describe("loadScriptedAreas / saveScriptedAreas / resetScriptedAreas", () => {
  it("seeds from defaults when nothing is stored", () => {
    expect(loadScriptedAreas(memStorage())).toEqual(SCRIPTED_AREAS);
  });

  it("persists a valid set and loads it back", () => {
    const store = memStorage();
    const save = saveScriptedAreas([VALID], store);
    expect(save.ok).toBe(true);
    expect(store.getItem(AREA_STORAGE_KEY)).toBe(serializeAreas([VALID]));
    expect(loadScriptedAreas(store)).toEqual([VALID]);
  });

  it("does not persist an invalid set", () => {
    const store = memStorage();
    const save = saveScriptedAreas([{ ...VALID, w: 0 }], store);
    expect(save.ok).toBe(false);
    expect(store.getItem(AREA_STORAGE_KEY)).toBeNull();
  });

  it("reset clears storage and returns defaults", () => {
    const store = memStorage();
    saveScriptedAreas([VALID], store);
    const back = resetScriptedAreas(store);
    expect(store.getItem(AREA_STORAGE_KEY)).toBeNull();
    expect(back).toEqual(SCRIPTED_AREAS);
  });
});
