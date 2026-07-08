import { officeFurniture3D, officeLampGlows, type FurnitureBox } from "./officeFurniture3D";
import { PX_TO_WORLD } from "./officeGeometry3D";
import { ROOMS, WORLD_W, WORLD_H } from "../types";

describe("officeFurniture3D", () => {
  const boxes = officeFurniture3D();

  it("produces a rich set of furniture boxes across the floor", () => {
    // Nine department rooms of furniture + workstations + lamps + 6 stalls.
    expect(boxes.length).toBeGreaterThan(60);
  });

  it("gives every box a color, positive extents, and a floor-standing height", () => {
    for (const b of boxes) {
      expect(b.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.width).toBeGreaterThan(0);
      expect(b.depth).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it("keeps furniture within the world bounds", () => {
    const maxX = WORLD_W * PX_TO_WORLD;
    const maxZ = WORLD_H * PX_TO_WORLD;
    for (const b of boxes) {
      expect(b.cx).toBeGreaterThanOrEqual(0);
      expect(b.cx).toBeLessThanOrEqual(maxX);
      expect(b.cz).toBeGreaterThanOrEqual(0);
      expect(b.cz).toBeLessThanOrEqual(maxZ);
    }
  });

  it("includes the marketplace stalls (awning-colored boxes on the last row)", () => {
    const marketplace = ROOMS.find((r) => r.key === "marketplace")!;
    const rowZmin = marketplace.row * 288 * PX_TO_WORLD; // ROOM_H = 288
    const stallish = boxes.filter((b: FurnitureBox) => b.cz >= rowZmin);
    expect(stallish.length).toBeGreaterThanOrEqual(6);
  });

  it("marks some surfaces (monitors) as glowing", () => {
    expect(boxes.some((b) => b.glow)).toBe(true);
  });
});

describe("officeLampGlows", () => {
  const glows = officeLampGlows();

  it("emits a positive-radius, colored glow pool per lamped room", () => {
    expect(glows.length).toBeGreaterThan(5);
    for (const g of glows) {
      expect(g.radius).toBeGreaterThan(0);
      expect(g.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
