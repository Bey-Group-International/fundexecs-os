import { fitInside, inkFromPixels } from "./ink";

describe("inkFromPixels", () => {
  it("makes white paper transparent and dark ink opaque, all in the ink colour", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255, 128, 128, 128, 255]);
    inkFromPixels(px);
    expect(px[3]).toBe(0); // paper
    expect(px[7]).toBeGreaterThan(250); // ink
    expect(px[11]).toBeGreaterThan(0); // grey is in between
    expect(px[11]).toBeLessThan(px[7]);
    expect([px[4], px[5], px[6]]).toEqual([17, 24, 39]);
  });
  it("keeps an already transparent pixel transparent", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0]);
    inkFromPixels(px);
    expect(px[3]).toBe(0);
  });
});

describe("fitInside", () => {
  it("keeps the shape and fits the box", () => {
    expect(fitInside(1600, 400, 760, 200)).toEqual({ width: 760, height: 190 });
    expect(fitInside(400, 400, 760, 200)).toEqual({ width: 200, height: 200 });
  });
  it("falls back to the box for an empty image", () => {
    expect(fitInside(0, 0, 760, 200)).toEqual({ width: 760, height: 200 });
  });
});
