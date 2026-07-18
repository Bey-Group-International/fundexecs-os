/**
 * Pixel Studio unit + integration tests (jest, node env).
 * Covers manifest validation, palettes, layer ordering/occlusion, compatibility,
 * animation indexing, seeded randomization, migration, WA sheet mapping, Tiled
 * transform + round-trip, compositor determinism/immutability, PBR response,
 * and ZIP round-trip.
 */
import { AssetRegistry } from "./asset-registry";
import { AnimationPlayer } from "./animation-player";
import { migrateConfig, randomize, defaultConfig, encodeShare, decodeShare } from "./character";
import { createComposer } from "./compositor";
import { buildManifest } from "./manifest-build";
import { validateManifest, REQUIRED_COUNTS } from "./manifest";
import { isMonotonicRamp, paletteContrastSpread, parseColor } from "./palette-engine";
import { renderPbr, DEFAULT_LIGHT } from "./pbr/pbr-preview";
import { makeZip } from "./zip";
import { listZip } from "./zip-read";
import { toTiled, fromTiled, tiledReport } from "./adapters/tiled";
import { buildWorkAdventureLayers, workAdventureReport } from "./adapters/workadventure";
import { templateOpenOffice } from "./map/map-project";
import type { CharacterConfig } from "./types";

const manifest = buildManifest();
const registry = new AssetRegistry(manifest);
const composer = createComposer(registry);
const example = manifest.examples[0];

describe("manifest", () => {
  it("passes schema + semantic validation", () => {
    const v = validateManifest(manifest);
    expect(v.schemaErrors).toEqual([]);
    expect(v.semanticErrors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("meets every required inventory count", () => {
    const v = validateManifest(manifest);
    for (const [key, required] of Object.entries(REQUIRED_COUNTS)) {
      expect(v.counts[key]).toBe(required);
    }
  });

  it("has unique asset ids", () => {
    const ids = manifest.assets.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("palettes", () => {
  it("all ramps are monotonic in luminance", () => {
    for (const p of Object.values(manifest.palettes)) expect(isMonotonicRamp(p)).toBe(true);
  });
  it("skin palettes keep equivalent contrast spread", () => {
    const spreads = Object.values(manifest.palettes).filter((p) => p.group === "skin").map(paletteContrastSpread);
    expect(spreads.length).toBe(6);
    expect(Math.max(...spreads) - Math.min(...spreads)).toBeLessThan(60);
  });
  it("parses hex and rgba colors", () => {
    expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseColor("rgba(0,128,255,0.5)")).toEqual({ r: 0, g: 128, b: 255, a: 128 });
  });
});

describe("layer ordering & occlusion", () => {
  it("orders layers by zIndex ascending", () => {
    const layers = registry.resolveLayers(example);
    for (let i = 1; i < layers.length; i++) expect(layers[i].zIndex).toBeGreaterThanOrEqual(layers[i - 1].zIndex);
  });

  it("a full head covering occludes front hair", () => {
    const cfg: CharacterConfig = { ...defaultConfig(manifest), hair: "hair-m-side-part", headCovering: "headcovering-hijab-classic" };
    const slots = registry.resolveLayers(cfg).map((l) => l.slot);
    expect(slots).not.toContain("hair.front");
    expect(slots).toContain("headCovering.front");
  });

  it("a kufi does not occlude hair", () => {
    const cfg: CharacterConfig = { ...defaultConfig(manifest), hair: "hair-m-side-part", headCovering: "headcovering-kufi" };
    const slots = registry.resolveLayers(cfg).map((l) => l.slot);
    expect(slots).toContain("hair.front");
  });
});

describe("compatibility rules", () => {
  it("flags mutually-exclusive glasses", () => {
    const cfg: CharacterConfig = { ...defaultConfig(manifest), accessories: ["accessory-glasses-rect", "accessory-glasses-round"] };
    const issues = registry.validateConfig(cfg);
    expect(issues.length).toBeGreaterThan(0);
  });
  it("accepts a single accessory of each kind", () => {
    const cfg: CharacterConfig = { ...defaultConfig(manifest), accessories: ["accessory-glasses-rect", "accessory-watch", "accessory-tablet"] };
    expect(registry.validateConfig(cfg)).toEqual([]);
  });
});

describe("animation player", () => {
  it("indexes walk frames 0,1,2 looping", () => {
    const p = new AnimationPlayer("walk", manifest.animations.walk);
    p.tick(0); // start
    const seen: number[] = [p.frame];
    for (let t = 1; t <= 6; t++) {
      p.tick(t * 1000); // large dt forces advance every tick
      seen.push(p.frame);
    }
    expect(Math.max(...seen)).toBe(2);
    expect(Math.min(...seen)).toBe(0);
  });
  it("holds the last frame for non-looping approve", () => {
    const p = new AnimationPlayer("approve", manifest.animations.approve);
    p.tick(0);
    for (let t = 1; t <= 20; t++) p.tick(t * 1000);
    expect(p.frame).toBe(manifest.animations.approve.framesPerDirection - 1);
    expect(p.playing).toBe(false);
  });
});

describe("seeded randomization", () => {
  it("is reproducible for the same seed", () => {
    const base = defaultConfig(manifest);
    const a = randomize(registry, base, 12345);
    const b = randomize(registry, base, 12345);
    expect(a).toEqual(b);
  });
  it("differs for different seeds (usually)", () => {
    const base = defaultConfig(manifest);
    const a = randomize(registry, base, 1);
    const b = randomize(registry, base, 2);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });
  it("respects locked categories", () => {
    const base: CharacterConfig = { ...defaultConfig(manifest), skinPalette: "skin-olive-06-deep" };
    const locked = new Set(["skin" as const]);
    for (let s = 0; s < 5; s++) expect(randomize(registry, base, s, locked).skinPalette).toBe("skin-olive-06-deep");
  });
});

describe("migration", () => {
  it("drops unknown assets and bumps version", () => {
    const raw: CharacterConfig = { ...defaultConfig(manifest), manifestVersion: "0.0.1", hair: "hair-does-not-exist", accessories: ["accessory-glasses-rect", "accessory-ghost"] };
    const { config, changed, notes } = migrateConfig(registry, raw);
    expect(changed).toBe(true);
    expect(config.hair).toBeNull();
    expect(config.accessories).toEqual(["accessory-glasses-rect"]);
    expect(config.manifestVersion).toBe(manifest.packageVersion);
    expect(notes.length).toBeGreaterThan(0);
  });
  it("share tokens round-trip", () => {
    const token = encodeShare(example);
    expect(decodeShare(token)).toEqual(example);
  });
});

describe("WorkAdventure adapter", () => {
  it("produces six 96×128 category walk sheets", () => {
    const layers = buildWorkAdventureLayers(registry, example);
    expect(layers.length).toBe(6);
    for (const l of layers) {
      expect(l.sheet.width).toBe(96);
      expect(l.sheet.height).toBe(128);
    }
  });
  it("marks extended states unsupported in the report", () => {
    const r = workAdventureReport(registry, example, "t");
    expect(r.entries.some((e) => e.status === "unsupported")).toBe(true);
  });
});

describe("Tiled adapter", () => {
  it("includes a floorLayer and 32px orthogonal grid", () => {
    const t = toTiled(templateOpenOffice());
    expect(t.tilewidth).toBe(32);
    expect(t.orientation).toBe("orthogonal");
    expect(t.layers.some((l) => l.name === "floorLayer")).toBe(true);
  });
  it("round-trips collision, spawn, and dimensions", () => {
    const project = templateOpenOffice();
    const back = fromTiled(toTiled(project));
    const cBefore = project.layers.find((l) => l.id === "collisions")!.placements.length;
    const cAfter = back.layers.find((l) => l.id === "collisions")!.placements.length;
    expect(cAfter).toBe(cBefore);
    expect(back.layers.find((l) => l.id === "spawns")!.placements.length).toBeGreaterThan(0);
    expect(back.width).toBe(project.width);
    expect(back.height).toBe(project.height);
  });
  it("reports a compatible map", () => {
    expect(tiledReport(templateOpenOffice(), "t").ok).toBe(true);
  });
});

describe("compositor", () => {
  it("produces correctly-sized state sheets", () => {
    for (const state of ["idle", "walk", "talk", "approve"] as const) {
      const def = manifest.animations[state];
      const sheet = composer.composeStateSheet(example, state);
      expect(sheet.width).toBe(def.width);
      expect(sheet.height).toBe(def.height);
    }
  });
  it("is deterministic", () => {
    const a = composer.composeFrame(example, "walk", "down", 1);
    const b = composer.composeFrame(example, "walk", "down", 1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
  it("8× review is an exact nearest-neighbor upscale", () => {
    const native = composer.composeFrame(example, "idle", "down", 0);
    const review = native.scaleNearest(8);
    expect(review.width).toBe(256);
    for (let i = 0; i < 32; i++) {
      const s = native.get(i, i);
      expect(review.get(i * 8 + 3, i * 8 + 3)).toEqual(s);
    }
  });
  it("renders a readable silhouette", () => {
    expect(composer.composeFrame(example, "idle", "down", 0).opaqueCount()).toBeGreaterThan(80);
  });
});

describe("PBR showcase", () => {
  it("does not mutate the native frame", () => {
    const native = composer.composeFrame(example, "idle", "down", 0);
    const before = Array.from(native.data);
    const mf = composer.composeFrameWithMaterials(example, "idle", "down", 0);
    renderPbr(mf, Object.values(manifest.materials), DEFAULT_LIGHT);
    const after = composer.composeFrame(example, "idle", "down", 0);
    expect(Array.from(after.data)).toEqual(before);
  });
  it("responds to light direction", () => {
    const mf = composer.composeFrameWithMaterials(example, "idle", "down", 0);
    const left = renderPbr(mf, Object.values(manifest.materials), { ...DEFAULT_LIGHT, keyDir: { x: -1, y: 0, z: 0.5 } });
    const right = renderPbr(mf, Object.values(manifest.materials), { ...DEFAULT_LIGHT, keyDir: { x: 1, y: 0, z: 0.5 } });
    expect(Array.from(left.data)).not.toEqual(Array.from(right.data));
  });
});

describe("zip", () => {
  it("round-trips stored entries", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const zip = makeZip([{ path: "a/b.bin", data }]);
    const entries = listZip(zip);
    expect(entries[0].path).toBe("a/b.bin");
    expect(Array.from(entries[0].data)).toEqual([1, 2, 3, 4, 5]);
  });
});
