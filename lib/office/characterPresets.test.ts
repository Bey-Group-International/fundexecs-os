import fs from "fs";
import path from "path";
import {
  CHARACTER_PRESETS,
  getCharacterPreset,
  isCharacterPreset,
} from "@/lib/office/characterPresets";

const PUBLIC = path.resolve(__dirname, "../../public");

describe("characterPresets", () => {
  it("exposes ten presets with unique ids and non-empty labels", () => {
    expect(CHARACTER_PRESETS).toHaveLength(10);
    const ids = new Set(CHARACTER_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(10);
    for (const p of CHARACTER_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("points every preset at asset files that exist on disk", () => {
    for (const p of CHARACTER_PRESETS) {
      expect(p.atlas).toBe(`/assets/fundexecs/user-characters/${p.id}/walk.png`);
      expect(p.portrait).toBe(`/assets/fundexecs/user-characters/${p.id}/portrait.png`);
      expect(fs.existsSync(path.join(PUBLIC, p.atlas))).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC, p.portrait))).toBe(true);
    }
  });

  it("resolves and validates preset ids", () => {
    expect(isCharacterPreset("auburn-hoodie")).toBe(true);
    expect(isCharacterPreset("nope")).toBe(false);
    expect(isCharacterPreset(null)).toBe(false);
    expect(getCharacterPreset("auburn-hoodie")?.id).toBe("auburn-hoodie");
    expect(getCharacterPreset("nope")).toBeNull();
    expect(getCharacterPreset("")).toBeNull();
    expect(getCharacterPreset(null)).toBeNull();
  });
});
