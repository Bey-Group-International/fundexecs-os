// What the masking chain actually does to a frame.
//
// These used to be two describes in backgrounds.test.ts that read
// `background-processor.ts` as text, because the chain lived on a class that
// built its own canvases and reached MediaPipe through a dynamic import jsdom
// cannot resolve. They admitted their own weakness: "This catches the revert; it
// does not prove the call runs."
//
// The chain now takes its surfaces from a factory and its mask as a plain array,
// so it runs here in full against a recording context. What that buys is the one
// property a regex could never reach: that no step RAISES coverage inside an
// enclosed gap. `destination-in` keeps the camera frame where the mask covers,
// so coverage in the gap between two colleagues is a strip of their real room
// reaching the outgoing track while they have an effect switched on -- which is
// exactly the bug this chain shipped, and exactly what a source match for
// "calls quietCoverageGaps before dilateCeiling" cannot tell you has stopped.

import {
  MaskCompositor,
  type Drawable,
  type SurfaceFactory,
} from "./mask-compositor";
import { PERSON_LABEL, coverageFromConfidence, maskGrid } from "./backgrounds";

/** One recorded context call, tagged with which surface it was made on. */
interface Call {
  surface: string;
  op: string;
  args: readonly unknown[];
}

interface Recorder {
  factory: SurfaceFactory;
  calls: Call[];
  /** Surfaces in creation order, which is how the tests name them. */
  names: string[];
  sizes: Record<string, { width: number; height: number; alpha: boolean }>;
  /** Every alpha channel handed to putImageData, snapshotted. */
  masks: Uint8ClampedArray[];
  ops(surface: string): string[];
}

/**
 * The six surfaces `create` builds, in the order it builds them.
 *
 * Named here so the assertions below can say "the scratch surface" instead of
 * "s1", and pinned by its own test, so a reordering inside `create` fails loudly
 * rather than quietly re-pointing every other test in this file at the wrong
 * canvas.
 */
const SURFACES = ["output", "scratch", "mask", "segInput", "feathered", "backdrop"] as const;

function recorder(): Recorder {
  const calls: Call[] = [];
  const names: string[] = [];
  const sizes: Recorder["sizes"] = {};
  const masks: Uint8ClampedArray[] = [];

  const factory: SurfaceFactory = (width, height, opts) => {
    const name = names.length < SURFACES.length ? SURFACES[names.length] : `extra${names.length}`;
    names.push(name);
    sizes[name] = { width, height, alpha: opts.alpha };

    const surface = { width, height };
    const log = (op: string, ...args: unknown[]) => { calls.push({ surface: name, op, args }); };

    const ctx = {
      save: () => log("save"),
      restore: () => log("restore"),
      clearRect: (...a: unknown[]) => log("clearRect", ...a),
      beginPath: () => log("beginPath"),
      moveTo: (...a: unknown[]) => log("moveTo", ...a),
      lineTo: (...a: unknown[]) => log("lineTo", ...a),
      stroke: () => log("stroke"),
      fillRect: (...a: unknown[]) => log("fillRect", ...a),
      drawImage: (src: unknown, ...a: unknown[]) => {
        // Recorded by NAME, not by identity: what matters is which surface was
        // drawn where, and an object reference in a failure message is unreadable.
        const label = typeof src === "string" ? src
          : names.find((n) => sizes[n] && src === surfaceOf(n)) ?? "?";
        log("drawImage", label, ...a);
      },
      createImageData: (w: number, h: number) => ({
        width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: (image: { width: number; height: number; data: Uint8ClampedArray }) => {
        // Snapshotted: the compositor reuses one ImageData for the life of a
        // grid, so holding the reference would give every frame the last frame's
        // bytes.
        const alpha = new Uint8ClampedArray(image.width * image.height);
        for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = image.data[p];
        masks.push(alpha);
        log("putImageData");
      },
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      set filter(value: string) { log("filter", value); },
      get filter() { return "none"; },
      set globalCompositeOperation(value: string) { log("composite", value); },
      get globalCompositeOperation() { return "source-over"; },
      fillStyle: "" as unknown,
      strokeStyle: "" as unknown,
      lineWidth: 1,
    };

    const drawable = { surface, ctx } as unknown as Drawable;
    built.set(name, drawable.surface);
    return drawable;
  };

  const built = new Map<string, unknown>();
  const surfaceOf = (name: string) => built.get(name);

  return {
    factory, calls, names, sizes, masks,
    ops: (surface) => calls.filter((c) => c.surface === surface).map((c) => c.op),
  };
}

/** A frame the chain can draw. Its identity is a string so the log is readable. */
function frame(width: number, height: number) {
  return { source: "camera" as unknown as CanvasImageSource, width, height };
}

/**
 * A confidence mask at grid resolution, filled by a predicate.
 *
 * Grid resolution so `sampleCoverageFromConfidence` takes its fast path and the
 * cell at (x, y) is the cell the test put there -- the resampling path is pinned
 * in backgrounds.test.ts and is not what these tests are about.
 */
function confidenceAt(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): { kind: "confidence"; data: Float32Array; width: number; height: number } {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = value(x, y);
  }
  return { kind: "confidence", data, width, height };
}

/**
 * Confidence in the uncertainty band, chosen so the tests are not vacuous.
 *
 * 0.13 ramps to coverage 88: under `GAP_QUIET_CEILING` (96), so quieting applies
 * to it, and far enough above the midpoint that `sharpenEdge` leaves 48 rather
 * than clamping it to zero. A fainter value -- 0.05, which was the first choice
 * here -- reaches the mask as 0 whether it was quieted or not, and every
 * assertion about the gap then passes on a chain that never quieted anything.
 */
const FAINT = 0.13;
const SOLID = 1;

describe("the surfaces the chain builds", () => {
  it("builds them in the order the tests name them", () => {
    const rec = recorder();
    const grid = maskGrid(64, 48);
    expect(MaskCompositor.create(rec.factory, 64, 48)).not.toBeNull();

    expect(rec.names).toEqual([...SURFACES]);
    expect(rec.sizes.output).toEqual({ width: 64, height: 48, alpha: false });
    expect(rec.sizes.scratch).toEqual({ width: 64, height: 48, alpha: true });
    expect(rec.sizes.mask).toEqual({ width: grid.width, height: grid.height, alpha: true });
    expect(rec.sizes.segInput).toEqual({ width: grid.width, height: grid.height, alpha: false });
    expect(rec.sizes.feathered).toEqual({ width: grid.width, height: grid.height, alpha: true });
    expect(rec.sizes.backdrop).toEqual({ width: 32, height: 24, alpha: false });
  });

  /**
   * A browser that refuses a context is a fallback, not an exception. There is a
   * real cause: a page that has exhausted its WebGL/2D context pool, which a call
   * with a dozen tiles and a screen share can reach.
   */
  it("reports that it cannot run rather than throwing", () => {
    const refuseThird: SurfaceFactory = (() => {
      let n = 0;
      return () => (n++ === 2 ? null : { surface: { width: 0, height: 0 }, ctx: {} } as unknown as Drawable);
    })();
    expect(MaskCompositor.create(refuseThird, 64, 48)).toBeNull();
  });
});

describe("the composite keeps the frame where the mask covers", () => {
  it("paints the background first, then the masked person over it", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const grid = c.grid;
    c.setEffect({ kind: "template", id: "neural" });
    c.compose(frame(64, 48), confidenceAt(grid.width, grid.height, () => SOLID));

    // On the scratch surface: the camera frame, then `destination-in` with the
    // feathered mask. That operator is the whole reason coverage in a gap leaks
    // the room -- it KEEPS what the mask covers -- so the order is asserted
    // rather than described.
    const scratch = rec.calls.filter((call) => call.surface === "scratch");
    const composite = scratch.findIndex((call) => call.op === "composite" && call.args[0] === "destination-in");
    const camera = scratch.findIndex((call) => call.op === "drawImage" && call.args[0] === "camera");
    const mask = scratch.findIndex((call) => call.op === "drawImage" && call.args[0] === "feathered");
    expect(camera).toBeGreaterThanOrEqual(0);
    expect(composite).toBeGreaterThan(camera);
    expect(mask).toBeGreaterThan(composite);

    // And on the output: something that is not the camera, then the scratch.
    const output = rec.calls.filter((call) => call.surface === "output" && call.op === "drawImage");
    expect(output.map((call) => call.args[0])).toEqual(["extra6", "scratch"]);
  });

  it("softens the mask at grid size, by a distance measured in frame pixels", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 1280, 720)!;
    const grid = c.grid;
    c.compose(frame(1280, 720), confidenceAt(grid.width, grid.height, () => SOLID));

    const blur = rec.calls.find((call) => call.surface === "feathered" && call.op === "filter");
    // maskFeatherPx(1280) = 5 frame pixels, over a grid 2.66 frame pixels across.
    expect(blur?.args[0]).toBe(`blur(${5 / grid.scale}px)`);
  });

  /**
   * With an effect on and no mask to apply it with, the room goes out of focus
   * rather than sharp.
   *
   * This test used to assert the opposite, and the comment it was asserting said
   * why: a black frame is video nobody can see, so the unprocessed camera is the
   * honest thing to show. The first half of that still holds; the second half was
   * answering the wrong question. For the few seconds the 12MB runtime takes to
   * arrive, and on every frame the model returns nothing for, what went out was
   * the sharp room — which is the one thing somebody who turned a background on
   * asked not to send. Out of focus keeps a moving person on screen and makes
   * what is behind them unreadable, and needs neither a model nor artwork.
   */
  it("veils the room when there is no mask yet", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    c.setEffect({ kind: "blur", strength: "heavy" });
    c.passThrough(frame(64, 48));

    // No person is composited -- there is no mask to do it with.
    expect(rec.ops("scratch")).toEqual([]);
    const backdrop = rec.calls.filter((call) => call.surface === "backdrop");
    expect(backdrop.some((call) => call.op === "filter" && String(call.args[0]).startsWith("blur("))).toBe(true);
    // And what reaches the output is that surface, not the camera.
    expect(rec.calls.filter((call) => call.surface === "output" && call.op === "drawImage"))
      .toEqual([{ surface: "output", op: "drawImage", args: ["backdrop", 0, 0, 64, 48] }]);
  });

  /**
   * And with no effect on, nothing is veiled. Somebody who has not asked for a
   * background gets their camera, which is also what the waiting-room preview and
   * every unprocessed path depends on.
   */
  it("draws the plain camera when no effect is on", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    c.passThrough(frame(64, 48));

    expect(rec.calls.filter((call) => call.surface === "output"))
      .toEqual([{ surface: "output", op: "drawImage", args: ["camera", 0, 0, 64, 48] }]);
    expect(rec.calls.filter((call) => call.surface === "backdrop")).toEqual([]);
  });
});

/**
 * The two shape passes, through the real chain.
 *
 * mask-structure.test.ts proves the rules; this proves the compositor runs them,
 * in the order that keeps them honest, and that what comes out the far end of the
 * blend and the edge tightening still has the hole closed and the chair kept.
 */
describe("what the person is touching, and what is inside them", () => {
  const WIDTH = 160;
  const HEIGHT = 120;
  const CHAIR = 0.16;   // the confidence backgrounds.ts measured for a chair edge

  /** Somebody in a chair, with a hole in their chest and a shelf across the room. */
  const seated = () => confidenceAt(WIDTH, HEIGHT, (x, y) => {
    if (x >= 78 && x <= 80 && y >= 70 && y <= 72) return 0.03;      // the hole
    if (x >= 60 && x <= 100 && y >= 40 && y <= 110) return SOLID;   // torso
    if (x >= 46 && x <= 59 && y >= 50 && y <= 110) return CHAIR;    // chair back
    if (x >= 5 && x <= 20 && y >= 5 && y <= 25) return CHAIR;       // a shelf, far off
    return 0;
  });

  const alphaAt = (mask: Uint8ClampedArray, x: number, y: number) => mask[y * WIDTH + x];

  it("is measuring a mask that really had a hole and a chair in it", () => {
    // Otherwise everything below passes on a frame with nothing to find.
    expect(coverageFromConfidence(0.03)).toBe(0);
    expect(coverageFromConfidence(CHAIR)).toBeGreaterThan(0);
    expect(coverageFromConfidence(CHAIR)).toBeLessThan(200);
  });

  it("closes the hole, keeps the chair, and leaves the far shelf hidden", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    expect(c.grid).toEqual({ width: WIDTH, height: HEIGHT, scale: 1 });
    c.setEffect({ kind: "blur", strength: "heavy" });
    c.compose(frame(WIDTH, HEIGHT), seated());

    const mask = rec.masks[0];
    expect(alphaAt(mask, 79, 71)).toBe(255);          // the hole, filled
    expect(alphaAt(mask, 52, 80)).toBeGreaterThan(200); // the chair, kept
    expect(alphaAt(mask, 12, 15)).toBe(0);            // the shelf, hidden
    expect(alphaAt(mask, 140, 10)).toBe(0);           // and the wall
  });
});

/**
 * The property the whole gap change turns on.
 *
 * A 64px frame is used deliberately: at that size the dilation radii round down
 * to a falloff that spreads nothing, so what reaches the mask is the quieting and
 * the ceiling alone, with no growth to confuse the reading. The 1280px case below
 * is where growth is real.
 */
describe("nothing raises coverage inside an enclosed gap", () => {
  const WIDTH = 64;
  const HEIGHT = 48;
  const ROW = 10;
  const LEFT = [10, 20] as const;
  const RIGHT = [26, 36] as const;
  const GAP = [21, 25] as const;

  /** Two people in one row with a faint, wandering strip of room between them. */
  const twoPeople = () => confidenceAt(WIDTH, HEIGHT, (x, y) => {
    if (y !== ROW) return 0;
    if (x >= LEFT[0] && x <= LEFT[1]) return SOLID;
    if (x >= RIGHT[0] && x <= RIGHT[1]) return SOLID;
    if (x >= GAP[0] && x <= GAP[1]) return FAINT;
    return 0;
  });

  it("starts from a mask that really does have coverage in the gap", () => {
    // Otherwise the test below passes on a mask that never leaked.
    expect(coverageFromConfidence(FAINT)).toBeGreaterThan(0);
    expect(coverageFromConfidence(FAINT)).toBeLessThan(96);
  });

  it("hands the compositor's mask zero alpha across the gap", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    expect(c.grid).toEqual({ width: WIDTH, height: HEIGHT, scale: 1 });
    c.compose(frame(WIDTH, HEIGHT), twoPeople());

    const alpha = rec.masks.at(-1)!;
    for (let x = GAP[0]; x <= GAP[1]; x++) {
      expect(alpha[ROW * WIDTH + x]).toBe(0);
    }
  });

  it("keeps both people, so the gap was quieted and not the mask", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    c.compose(frame(WIDTH, HEIGHT), twoPeople());

    const alpha = rec.masks.at(-1)!;
    expect(alpha[ROW * WIDTH + LEFT[0] + 1]).toBe(255);
    expect(alpha[ROW * WIDTH + RIGHT[0] + 1]).toBe(255);
  });

  /**
   * The ordering the deleted source test was reaching for, as behaviour.
   *
   * Quieting runs before the growth ceiling is built, so the cells it zeroes are
   * closed to growth too. Were it to run afterwards, the ceiling would record
   * those faint cells as fillable and the side dilation would push the people's
   * 255 back across the gap. This asserts the gap stays empty on a frame wide
   * enough for that growth to be real.
   */
  it("still stays empty at a size where growth would otherwise fill it", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 1280, 720)!;
    const grid = c.grid;
    const gap: [number, number] = [240, 245];
    const row = 100;
    c.compose(frame(1280, 720), confidenceAt(grid.width, grid.height, (x, y) => {
      if (y !== row) return 0;
      if (x >= 200 && x < gap[0]) return SOLID;
      if (x > gap[1] && x <= 300) return SOLID;
      if (x >= gap[0] && x <= gap[1]) return FAINT;
      return 0;
    }));

    const alpha = rec.masks.at(-1)!;
    for (let x = gap[0]; x <= gap[1]; x++) {
      expect(alpha[row * grid.width + x]).toBe(0);
    }
  });

  /**
   * The category path has no graded tail of its own to leak.
   *
   * It is a bare yes/no at a threshold the model chose, so at grid resolution
   * every cell arrives 0 or 255 and there is nothing under the quieting ceiling
   * to find. Quieting still runs on it -- the call sits before the branch that
   * tells the two paths apart -- and this records the reason that is belt and
   * braces rather than load-bearing: anything this path could leak would have to
   * come from a build returning graded values through it.
   */
  it("arrives binary on the category path, with nothing in the gap", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    // Inverted from what it looks like it should be, and the constant is
    // imported rather than written out so the test cannot drift from it: the
    // shipped model has one class, so the PERSON is label 0 and everything else
    // is 255, MediaPipe's filler for "no category".
    const data = new Uint8Array(WIDTH * HEIGHT).fill(255);
    for (let x = LEFT[0]; x <= LEFT[1]; x++) data[ROW * WIDTH + x] = PERSON_LABEL;
    for (let x = RIGHT[0]; x <= RIGHT[1]; x++) data[ROW * WIDTH + x] = PERSON_LABEL;
    // What a graded build would put here. On this path it is thresholded away.
    for (let x = GAP[0]; x <= GAP[1]; x++) data[ROW * WIDTH + x] = 40;
    c.compose(frame(WIDTH, HEIGHT), { kind: "category", data, width: WIDTH, height: HEIGHT });

    const alpha = rec.masks.at(-1)!;
    expect([...new Set(alpha)].sort((a, b) => a - b)).toEqual([0, 255]);
    for (let x = GAP[0]; x <= GAP[1]; x++) expect(alpha[ROW * WIDTH + x]).toBe(0);
    expect(alpha[ROW * WIDTH + LEFT[0] + 1]).toBe(255);
  });
});

describe("growth over headwear", () => {
  it("fills an uncertain band above a solid body", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 1280, 720)!;
    const grid = c.grid;
    const band = [40, 44] as const;
    const body = 45;
    const column = 200;
    c.compose(frame(1280, 720), confidenceAt(grid.width, grid.height, (x, y) => {
      if (x < column || x > column + 40) return 0;
      if (y >= body && y <= body + 40) return SOLID;
      if (y >= band[0] && y <= band[1]) return FAINT;
      return 0;
    }));

    const alpha = rec.masks.at(-1)!;
    expect(alpha[band[1] * grid.width + column + 20]).toBe(255);
  });

  /**
   * And the ceiling is applied only on the graded path, which is the other half
   * of the same decision. A category mask has no uncertainty band, so a ceiling
   * built from it would forbid all growth and hand back exactly the missing
   * headwear growth exists to keep. So here growth DOES reach above the body.
   */
  it("grows unconstrained on the category path, which has no uncertainty band", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 1280, 720)!;
    const grid = c.grid;
    const body = 45;
    const column = 200;
    const data = new Uint8Array(grid.width * grid.height).fill(255);
    for (let y = body; y <= body + 40; y++) {
      for (let x = column; x <= column + 40; x++) data[y * grid.width + x] = PERSON_LABEL;
    }
    c.compose(frame(1280, 720), { kind: "category", data, width: grid.width, height: grid.height });

    const alpha = rec.masks.at(-1)!;
    expect(alpha[(body - 1) * grid.width + column + 20]).toBeGreaterThan(0);
  });

  it("does not invent coverage where the model was confident there is none", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 1280, 720)!;
    const grid = c.grid;
    const body = 45;
    const column = 200;
    c.compose(frame(1280, 720), confidenceAt(grid.width, grid.height, (x, y) => (
      x >= column && x <= column + 40 && y >= body && y <= body + 40 ? SOLID : 0
    )));

    const alpha = rec.masks.at(-1)!;
    // One row above the body, where confidence was exactly zero.
    expect(alpha[(body - 1) * grid.width + column + 20]).toBe(0);
  });
});

describe("the mask carried between frames", () => {
  const WIDTH = 64;
  const HEIGHT = 48;
  const all = (v: number) => confidenceAt(WIDTH, HEIGHT, () => v);

  it("seeds from the first frame rather than fading the person in", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    c.compose(frame(WIDTH, HEIGHT), all(SOLID));
    expect(rec.masks[0][0]).toBe(255);
  });

  it("moves toward the new coverage without jumping to it", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    c.compose(frame(WIDTH, HEIGHT), all(SOLID));
    c.compose(frame(WIDTH, HEIGHT), all(0));

    // The whole point of the blend: a pixel the model reversed on does not snap.
    expect(rec.masks[1][0]).toBeGreaterThan(0);
    expect(rec.masks[1][0]).toBeLessThan(255);
  });

  it("forgets it on reset, so a resumed effect starts from the live mask", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    c.compose(frame(WIDTH, HEIGHT), all(SOLID));
    c.reset();
    c.compose(frame(WIDTH, HEIGHT), all(0));

    expect(rec.masks[1][0]).toBe(0);
  });

  it("forgets it when the camera changes shape", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, WIDTH, HEIGHT)!;
    c.compose(frame(WIDTH, HEIGHT), all(SOLID));

    // A device switch. Every grid-sized buffer is re-fitted, and a history
    // measured against the old grid would blend only its first cells.
    c.prepareSegmentInput(frame(96, 72));
    expect(c.grid).toEqual({ width: 96, height: 72, scale: 1 });
    expect(rec.sizes).toBeDefined();

    c.compose(frame(96, 72), confidenceAt(96, 72, () => 0));
    expect(rec.masks[1]).toHaveLength(96 * 72);
    expect(rec.masks[1][0]).toBe(0);
  });
});

/**
 * A decode is slow enough that the choice behind it can be stale by the time it
 * lands: somebody uploads a picture and switches to blur while it is still
 * decoding. Whatever arrives then is a bitmap holding decoded pixels that
 * nothing will ever draw, and the sender -- a worker postMessage, in the route
 * being built -- has no reference left to close it with. So the contract is
 * unconditional: hand this a bitmap and it owns it, including when it cannot use
 * it.
 */
describe("the bitmaps handed to it", () => {
  const bitmap = () => {
    const close = jest.fn();
    return { image: { width: 8, height: 8, close } as unknown as ImageBitmap, close };
  };

  it("closes one it cannot use", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const late = bitmap();
    c.setEffect({ kind: "blur", strength: "heavy" }, late.image);
    expect(late.close).toHaveBeenCalledTimes(1);
  });

  it("keeps one it can", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const kept = bitmap();
    c.setEffect({ kind: "custom", id: "u1" }, kept.image);
    expect(kept.close).not.toHaveBeenCalled();

    // And draws it, rather than falling through to the camera.
    c.compose(frame(64, 48), confidenceAt(64, 48, () => SOLID));
    const background = rec.calls.find((call) => call.surface === "output" && call.op === "drawImage");
    expect(background?.args[0]).not.toBe("camera");
  });

  it("closes the one it was keeping when the effect moves off custom", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const kept = bitmap();
    c.setEffect({ kind: "custom", id: "u1" }, kept.image);
    c.setEffect({ kind: "blur", strength: "heavy" });
    expect(kept.close).toHaveBeenCalledTimes(1);
  });

  it("closes the one it was keeping when a replacement arrives", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const first = bitmap();
    const second = bitmap();
    c.setEffect({ kind: "custom", id: "u1" }, first.image);
    c.setEffect({ kind: "custom", id: "u2" }, second.image);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it("closes it on destroy", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const kept = bitmap();
    c.setEffect({ kind: "custom", id: "u1" }, kept.image);
    c.destroy();
    expect(kept.close).toHaveBeenCalledTimes(1);
  });

  /**
   * A bitmap transferred over `postMessage` is detached at the sender, and
   * `close()` on a detached one can throw. A throw here would abandon the rest
   * of an effect change half-applied.
   */
  it("survives a bitmap that throws on close", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    const detached = { width: 8, height: 8, close: () => { throw new Error("detached"); } } as unknown as ImageBitmap;
    expect(() => c.setEffect({ kind: "blur", strength: "heavy" }, detached)).not.toThrow();

    c.setEffect({ kind: "custom", id: "u1" }, detached);
    expect(() => c.setEffect({ kind: "blur", strength: "heavy" })).not.toThrow();
    expect(() => c.destroy()).not.toThrow();
  });
});

describe("what is painted behind the person", () => {
  it("blurs the room on a smaller surface and scales it up", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 1280, 720)!;
    const grid = c.grid;
    c.setEffect({ kind: "blur", strength: "heavy" });
    c.compose(frame(1280, 720), confidenceAt(grid.width, grid.height, () => SOLID));

    const backdrop = rec.calls.filter((call) => call.surface === "backdrop");
    expect(backdrop.some((call) => call.op === "filter" && String(call.args[0]).startsWith("blur("))).toBe(true);
    // Overdrawn past its own edges, because a blur samples outside its source and
    // would otherwise leave a pale border around the whole frame.
    const draw = backdrop.find((call) => call.op === "drawImage");
    expect(Number(draw?.args[1])).toBeLessThan(0);
    expect(Number(draw?.args[2])).toBeLessThan(0);
  });

  /**
   * An effect whose artwork has not arrived, or has gone. Never a blank rectangle
   * where a person was — and no longer the sharp room either, which was what this
   * test used to pin. The uploaded image may be seconds away or may have failed
   * for good, and in both cases the person is still composited over something
   * that is not a readable picture of their room.
   */
  it("veils the room when a custom image has not arrived", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    c.setEffect({ kind: "custom", id: "u1" }, null);
    c.compose(frame(64, 48), confidenceAt(64, 48, () => SOLID));

    const background = rec.calls.find((call) => call.surface === "output" && call.op === "drawImage");
    expect(background?.args[0]).toBe("backdrop");
    const backdrop = rec.calls.filter((call) => call.surface === "backdrop");
    expect(backdrop.some((call) => call.op === "filter" && String(call.args[0]).startsWith("blur("))).toBe(true);
  });

  it("paints a template once per frame size", () => {
    const rec = recorder();
    const c = MaskCompositor.create(rec.factory, 64, 48)!;
    c.setEffect({ kind: "template", id: "neural" });
    const mask = confidenceAt(64, 48, () => SOLID);
    c.compose(frame(64, 48), mask);
    const afterFirst = rec.calls.filter((call) => call.surface === "extra6" && call.op === "fillRect").length;
    c.compose(frame(64, 48), mask);
    const afterSecond = rec.calls.filter((call) => call.surface === "extra6" && call.op === "fillRect").length;

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);
  });
});
