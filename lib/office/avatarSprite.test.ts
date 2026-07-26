import {
  ATLAS_H,
  ATLAS_W,
  CELL,
  COLS,
  DIR,
  drawAvatarFrameParts,
  NATIVE,
  ROWS,
  UNIT,
  type Facing,
  type PixelSink,
} from "@/lib/office/avatarSprite";
import {
  ACCESSORIES,
  BODY_TYPES,
  DEFAULT_AVATAR_CONFIG,
  EXPRESSIONS,
  EYEWEAR,
  FACIAL_HAIR,
  HAIR_STYLES,
  HEADWEAR,
  HOLDING,
  OUTFITS,
  normalizeAvatarConfig,
} from "@/lib/office/avatarConfig";

// A canvas-free sink that records every fill so we can assert the generator
// paints, stays in bounds, and is deterministic — no real rasterizer needed.
type Call = { color: string; x: number; y: number; w: number; h: number };
class MockSink implements PixelSink {
  fillStyle = "#000000";
  calls: Call[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push({ color: String(this.fillStyle), x, y, w, h });
  }
}

const FACINGS: Facing[] = ["down", "up", "left", "right"];

describe("avatarSprite · atlas geometry", () => {
  it("matches the persona walk.png layout (3×4 of 256px cells)", () => {
    expect(COLS).toBe(3);
    expect(ROWS).toBe(4);
    expect(CELL).toBe(256);
    expect(UNIT).toBe(CELL / NATIVE);
    expect(ATLAS_W).toBe(COLS * CELL);
    expect(ATLAS_H).toBe(ROWS * CELL);
  });

  it("maps facings to the same row order as map.html dir (0 down,1 up,2 left,3 right)", () => {
    expect(DIR).toEqual({ down: 0, up: 1, left: 2, right: 3 });
  });
});

describe("avatarSprite · drawAvatarFrame", () => {
  it("paints something for every facing and walk frame", () => {
    for (const f of FACINGS) {
      for (let frame = 0; frame < COLS; frame++) {
        const s = new MockSink();
        drawAvatarFrameParts(s, DEFAULT_AVATAR_CONFIG, f, frame);
        expect(s.calls.length).toBeGreaterThan(5);
      }
    }
  });

  it("keeps every pixel inside the 256px cell", () => {
    const s = new MockSink();
    drawAvatarFrameParts(s, DEFAULT_AVATAR_CONFIG, "down", 1);
    for (const c of s.calls) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(CELL);
      expect(c.y + c.h).toBeLessThanOrEqual(CELL);
    }
  });

  it("never throws across the full option catalog cross-product", () => {
    // A representative sweep: vary one axis at a time over the whole catalog.
    const axes: Array<Partial<Record<string, string>>[]> = [
      BODY_TYPES.map((o) => ({ body: o.id })),
      HAIR_STYLES.map((o) => ({ hair: o.id })),
      FACIAL_HAIR.map((o) => ({ facialHair: o.id })),
      EXPRESSIONS.map((o) => ({ expression: o.id })),
      OUTFITS.map((o) => ({ outfit: o.id })),
      EYEWEAR.map((o) => ({ eyewear: o.id })),
      HEADWEAR.map((o) => ({ headwear: o.id })),
      ACCESSORIES.map((o) => ({ accessories: o.id })),
      HOLDING.map((o) => ({ holding: o.id })),
    ];
    for (const axis of axes) {
      for (const patch of axis) {
        const cfg = normalizeAvatarConfig({ ...DEFAULT_AVATAR_CONFIG, ...patch });
        for (const f of FACINGS) {
          const s = new MockSink();
          expect(() => drawAvatarFrameParts(s, cfg, f, 0)).not.toThrow();
          expect(s.calls.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is deterministic (same config → identical draw calls)", () => {
    const a = new MockSink();
    const b = new MockSink();
    drawAvatarFrameParts(a, DEFAULT_AVATAR_CONFIG, "down", 1);
    drawAvatarFrameParts(b, DEFAULT_AVATAR_CONFIG, "down", 1);
    expect(a.calls).toEqual(b.calls);
  });

  it("varies with appearance (a color change changes the output)", () => {
    const a = new MockSink();
    const b = new MockSink();
    drawAvatarFrameParts(a, DEFAULT_AVATAR_CONFIG, "down", 1);
    drawAvatarFrameParts(b, normalizeAvatarConfig({ ...DEFAULT_AVATAR_CONFIG, outfitColor: "burgundy" }), "down", 1);
    expect(a.calls).not.toEqual(b.calls);
  });

  it("mirrors right from left (right frame is the horizontal flip of left)", () => {
    const l = new MockSink();
    const r = new MockSink();
    drawAvatarFrameParts(l, DEFAULT_AVATAR_CONFIG, "left", 1);
    drawAvatarFrameParts(r, DEFAULT_AVATAR_CONFIG, "right", 1);
    expect(r.calls.length).toBe(l.calls.length);
    // Each right rect is the mirror (across CELL) of the matching left rect.
    for (let i = 0; i < l.calls.length; i++) {
      expect(r.calls[i].color).toBe(l.calls[i].color);
      expect(r.calls[i].x).toBeCloseTo(CELL - (l.calls[i].x + l.calls[i].w));
    }
  });

  it("bald draws no hair color (skin-only head), a hairstyle adds hair", () => {
    const bald = new MockSink();
    drawAvatarFrameParts(bald, normalizeAvatarConfig({ ...DEFAULT_AVATAR_CONFIG, hair: "bald", facialHair: "none" }), "up", 1);
    const haired = new MockSink();
    drawAvatarFrameParts(haired, normalizeAvatarConfig({ ...DEFAULT_AVATAR_CONFIG, hair: "short" }), "up", 1);
    expect(haired.calls.length).toBeGreaterThan(bald.calls.length);
  });
});

describe("avatarSprite · atlas assembly", () => {
  it("every cell's parts stay within its atlas slot", () => {
    const s = new MockSink();
    let count = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        drawAvatarFrameParts(s, DEFAULT_AVATAR_CONFIG, FACINGS[row], col, UNIT, col * CELL, row * CELL);
        count++;
      }
    }
    expect(count).toBe(12);
    expect(s.calls.length).toBeGreaterThan(120);
    for (const c of s.calls) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(ATLAS_W);
      expect(c.y + c.h).toBeLessThanOrEqual(ATLAS_H);
    }
  });
});
