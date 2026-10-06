// Shape, not pixels: what a person is touching, what is inside them, and what is
// just the room.
//
// Every scene here is built rather than captured, and built to be the case that
// was complained about. The confidences are the ones backgrounds.ts measured on a
// real camera: a chair edge reads 0.05-0.25, headwear 0.20-0.34, a wall reads
// about nothing. What makes these regression tests rather than demonstrations is
// that the last group runs the shipped pipeline end to end.

import {
  CONFIDENCE_PERSON,
  coverageFromConfidence,
  dilateCeiling,
  dilateCoverage,
  maskDilatePx,
  maskGapSpanPx,
  maskGrid,
  quietCoverageGaps,
  sampleCoverageFromConfidence,
} from "@/lib/meetings/backgrounds";
import {
  HOLE_HOLD_FRAMES,
  STRUCTURE_SOLID,
  createStructureScratch,
  createTemporalWindow,
  despeckleCoverage,
  steadyCoverage,
  fillEnclosedHoles,
  keepTouchingStructures,
  maskStructureReach,
} from "@/lib/meetings/mask-structure";

/** A grid of coverage values written as rows, for scenes small enough to read. */
function gridOf(rows: number[][]): { coverage: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const coverage = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) coverage[y * width + x] = rows[y][x];
  return { coverage, width, height };
}

const at = (g: { coverage: Uint8ClampedArray; width: number }, x: number, y: number) =>
  g.coverage[y * g.width + x];

describe("maskStructureReach", () => {
  it("is the same share of a face at every camera resolution", () => {
    const small = maskStructureReach(640, maskGrid(640, 360));
    const large = maskStructureReach(1920, maskGrid(1920, 1080));
    // Both grids are built to a target cell count, so a reach in GRID cells should
    // land close to the same number however big the camera is — that is the whole
    // point of expressing it against the frame and dividing by the scale.
    expect(Math.abs(small.reach - large.reach)).toBeLessThanOrEqual(2);
    expect(Math.abs(small.thickness - large.thickness)).toBeLessThanOrEqual(1);
  });

  it("orders the reaches the way the rules depend on", () => {
    const r = maskStructureReach(1280, maskGrid(1280, 720));
    // A structure is thinner than it is far, and the quiet line is beyond the
    // reach — otherwise a cell could be kept and zeroed by the same pass.
    expect(r.thickness).toBeLessThan(r.reach);
    expect(r.reach).toBeLessThan(r.quiet);
    expect(r.hole).toBeGreaterThan(0);
  });

  it("survives a camera that reports nonsense", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = maskStructureReach(bad, maskGrid(1280, 720));
      expect(r.thickness).toBeGreaterThan(0);
      expect(r.reach).toBeGreaterThan(0);
    }
  });
});

describe("keepTouchingStructures", () => {
  const scratch = createStructureScratch(64 * 64);
  const reach = { thickness: 2, reach: 6, quiet: 10, hole: 4 };

  /**
   * A person, and a chair back behind their shoulder that the model is unsure
   * about. The chair is four cells thick and touching, which is what it has to be
   * to be kept.
   */
  it("keeps a thick uncertain structure the person is touching", () => {
    const P = 255, u = 60, _ = 0;
    const g = gridOf([
      [_, _, _, _, _, _, _, _],
      [_, u, u, u, u, u, _, _],
      [_, u, u, P, P, u, _, _],
      [_, u, u, P, P, u, _, _],
      [_, u, u, P, P, u, _, _],
      [_, _, _, P, P, _, _, _],
    ]);
    keepTouchingStructures(g.coverage, g.width, g.height, reach, scratch);
    // The middle of the band is two cells from the room and next to the person.
    expect(at(g, 2, 3)).toBe(255);
    // And the room is still the room.
    expect(at(g, 0, 0)).toBe(0);
    expect(at(g, 7, 2)).toBe(0);
  });

  /**
   * The rule that makes the rest safe. A silhouette's own edge is a one- or
   * two-cell ramp, and hardening it would cut hair off in a staircase — which is
   * the fault the graded ramp exists to avoid.
   */
  it("leaves a silhouette's soft edge graded", () => {
    const P = 255, a = 180, b = 60, _ = 0;
    const g = gridOf([
      [_, _, _, _, _, _],
      [_, b, a, a, b, _],
      [_, b, a, P, a, _],
      [_, b, a, a, b, _],
      [_, _, _, _, _, _],
    ]);
    keepTouchingStructures(g.coverage, g.width, g.height, { ...reach, thickness: 3 }, scratch);
    // Nothing in a two-cell ramp reaches a thickness of three, so every graded
    // cell keeps the value the model gave it.
    expect(at(g, 1, 2)).toBe(60);
    expect(at(g, 2, 2)).toBe(180);
  });

  /**
   * Never a reveal. The guarantee the privacy finding on #1203 bought: a cell the
   * model scored at zero is room, and no amount of being next to a person makes it
   * anything else.
   */
  it("never raises a cell the model was sure was room", () => {
    const P = 255, _ = 0;
    const g = gridOf([
      [_, _, _, _],
      [_, P, P, _],
      [_, P, P, _],
      [_, _, _, _],
    ]);
    keepTouchingStructures(g.coverage, g.width, g.height, reach, scratch);
    expect([...g.coverage].filter((v) => v === 0)).toHaveLength(12);
  });

  it("holds a faint patch of room with nobody near it at zero", () => {
    // Twelve wide so the patch on the right is beyond the quiet line from the
    // person on the left.
    const P = 255, u = 24, _ = 0;
    const rows: number[][] = [];
    for (let y = 0; y < 5; y++) {
      const row = new Array(16).fill(_);
      if (y >= 1 && y <= 3) { row[1] = P; row[2] = P; }
      if (y === 2) { row[13] = u; row[14] = u; }
      rows.push(row);
    }
    const g = gridOf(rows);
    const report = keepTouchingStructures(g.coverage, g.width, g.height, reach, scratch);
    expect(at(g, 13, 2)).toBe(0);
    expect(at(g, 14, 2)).toBe(0);
    expect(report.quieted).toBe(2);
  });

  /**
   * The fence on the only rule here that subtracts. A cell the model gave more
   * than half to, with nobody near it, is likelier a person it is unsure about
   * everywhere — far away, badly lit, half out of frame — than a corner of room.
   */
  it("does not zero a distant cell the model gave real coverage to", () => {
    const u = 200 - 1, _ = 0;
    const rows: number[][] = [];
    for (let y = 0; y < 5; y++) rows.push(new Array(16).fill(_));
    rows[2][14] = u;
    const g = gridOf(rows);
    keepTouchingStructures(g.coverage, g.width, g.height, reach, scratch);
    expect(at(g, 14, 2)).toBe(u);
  });

  /**
   * The halo. At the production reaches, the model's own soft boundary -- two to
   * five cells of partial coverage all the way round a person -- must not be read
   * as a structure and hardened to full, or the sharpen downstream makes a
   * finger-wide band of sharp room of it. Five cells here, against the eight the
   * production thickness asks for; the old three-cell thickness kept this band.
   */
  it("does not harden a silhouette's own soft boundary at production reaches", () => {
    const grid = maskGrid(1280, 720);
    const production = maskStructureReach(1280, grid);
    const w = 40, h = 40;
    const scratch = createStructureScratch(w * h);
    const coverage = new Uint8ClampedArray(w * h);
    // A 10x10 person in the middle, wearing a five-cell ramp of faint coverage.
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) {
      const inside = x >= 15 && x < 25 && y >= 15 && y < 25;
      coverage[y * w + x] = inside ? 255 : 60;
    }
    const report = keepTouchingStructures(coverage, w, h, production, scratch);
    expect(report.kept).toBe(0);
    // The ramp keeps the value the model gave it, right up against the person.
    expect(coverage[20 * w + 14]).toBe(60);
    expect(coverage[20 * w + 10]).toBe(60);
    expect(production.thickness).toBeGreaterThan(5);
  });

  it("does nothing to a frame with nobody in it", () => {
    const g = gridOf([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const report = keepTouchingStructures(g.coverage, g.width, g.height, reach, scratch);
    expect(report).toEqual({ kept: 0, quieted: 0 });
    expect(Math.max(...g.coverage)).toBe(0);
  });

  it("refuses a grid it was not given room for", () => {
    const g = gridOf([[255, 60, 0]]);
    const tiny = createStructureScratch(1);
    expect(keepTouchingStructures(g.coverage, g.width, g.height, reach, tiny)).toEqual({ kept: 0, quieted: 0 });
    expect(at(g, 1, 0)).toBe(60);
  });

  /**
   * And refuses it on EITHER field being short, not just the first.
   *
   * The buffer here is PARTIALLY short, and that is the whole test. A buffer short
   * by everything reads back `undefined` for every cell, and `undefined` compares
   * false against every reach — so the unguarded pass coincidentally does nothing,
   * exactly like the guarded one, and an assertion against it passes either way.
   * (The first version of this test did that and survived the mutation.) Half a
   * buffer is the case that separates them: the cells inside it are decided and
   * the cells past it are not, so a pass that checked one buffer and wrote to two
   * would half-process the frame and report success.
   */
  it("refuses a short buffer whichever of the two fields it is", () => {
    const scene = () => gridOf([
      [255, 255, 60, 60, 60, 0],
      [255, 255, 60, 60, 60, 0],
      [255, 255, 60, 60, 60, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ]);

    // With both fields whole, the middle of that band is a structure and is kept —
    // otherwise the assertions below pass on a scene with nothing to decide.
    const whole = scene();
    keepTouchingStructures(whole.coverage, whole.width, whole.height, reach,
      createStructureScratch(whole.coverage.length));
    expect(at(whole, 3, 1)).toBe(255);

    for (const field of ["toBackground", "toPerson"] as const) {
      const g = scene();
      const half = {
        ...createStructureScratch(g.coverage.length),
        [field]: new Uint16Array(Math.floor(g.coverage.length / 2)),
      };
      expect(keepTouchingStructures(g.coverage, g.width, g.height, reach, half))
        .toEqual({ kept: 0, quieted: 0 });
      expect(at(g, 3, 1)).toBe(60);
    }
  });
});

describe("fillEnclosedHoles", () => {
  const scratch = createStructureScratch(64 * 64);

  it("fills a small hole inside a person", () => {
    const P = 255, _ = 0;
    const g = gridOf([
      [_, _, _, _, _],
      [_, P, P, P, _],
      [_, P, _, P, _],
      [_, P, P, P, _],
      [_, _, _, _, _],
    ]);
    const report = fillEnclosedHoles(g.coverage, g.width, g.height, 3, scratch);
    expect(at(g, 2, 2)).toBe(255);
    expect(report).toEqual({ filled: 1, cells: 1, skipped: 0, held: 0 });
  });

  /**
   * The case the cap exists for. Two people shoulder to shoulder with their heads
   * nearly touching enclose a tall narrow slot of their room, and
   * `quietCoverageGaps` holds it at zero on purpose. Filling it would put a sharp
   * strip of that room back into a call they turned a background on for.
   */
  it("refuses a tall slot between two people", () => {
    const P = 255, _ = 0;
    const rows: number[][] = [];
    for (let y = 0; y < 12; y++) {
      const row = new Array(7).fill(_);
      row[1] = P; row[2] = P; row[4] = P; row[5] = P;
      // Heads touching at the top, shoulders at the bottom: the slot is enclosed.
      if (y === 0 || y === 11) row[3] = P;
      rows.push(row);
    }
    const g = gridOf(rows);
    const report = fillEnclosedHoles(g.coverage, g.width, g.height, 4, scratch);
    expect(at(g, 3, 6)).toBe(0);
    expect(report.filled).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("leaves the room alone, because the room reaches the edge of the frame", () => {
    const P = 255, _ = 0;
    const g = gridOf([
      [_, _, _, _, _],
      [_, P, P, P, _],
      [_, P, P, P, _],
      [_, _, _, _, _],
    ]);
    const report = fillEnclosedHoles(g.coverage, g.width, g.height, 99, scratch);
    expect(report.filled).toBe(0);
    expect(at(g, 0, 0)).toBe(0);
  });

  /**
   * Most people are cut off by the edge of frame at the shoulders, so the room
   * behind them touches the border on two sides and is not enclosed by anybody.
   * A fill that read "unreachable going left" rather than "unreachable" would
   * paint the whole background in.
   */
  it("is not fooled by a person standing against the edge of frame", () => {
    const P = 255, _ = 0;
    const rows: number[][] = [];
    for (let y = 0; y < 6; y++) {
      const row = new Array(6).fill(_);
      if (y >= 3) { row[2] = P; row[3] = P; }
      rows.push(row);
    }
    const g = gridOf(rows);
    const report = fillEnclosedHoles(g.coverage, g.width, g.height, 99, scratch);
    expect(report.filled).toBe(0);
    expect(at(g, 0, 0)).toBe(0);
    expect(at(g, 5, 5)).toBe(0);
  });

  it("counts a graded cell as part of the hole, not as part of the person", () => {
    // Anything under the solid line is open: a hole half-covered by the model is
    // still a hole, and leaving it graded leaves the replacement showing through
    // a person at half strength.
    const P = 255, u = 100, _ = 0;
    const g = gridOf([
      [_, _, _, _, _],
      [_, P, P, P, _],
      [_, P, u, P, _],
      [_, P, P, P, _],
      [_, _, _, _, _],
    ]);
    fillEnclosedHoles(g.coverage, g.width, g.height, 3, scratch);
    expect(at(g, 2, 2)).toBe(255);
  });

  it("fills several holes in one pass", () => {
    const P = 255, _ = 0;
    const g = gridOf([
      [_, _, _, _, _, _, _],
      [_, P, P, P, P, P, _],
      [_, P, _, P, _, P, _],
      [_, P, P, P, P, P, _],
      [_, _, _, _, _, _, _],
    ]);
    const report = fillEnclosedHoles(g.coverage, g.width, g.height, 3, scratch);
    expect(report.filled).toBe(2);
    expect(at(g, 2, 2)).toBe(255);
    expect(at(g, 4, 2)).toBe(255);
  });
});

/**
 * The hold: a dropout wider than the cap, bridged because it was covered a frame
 * ago, and let go of before it can become a reveal.
 *
 * The scene is a 12x12 person with a 6x6 patch inside them, against a cap of 3,
 * so the patch is refused on size alone and only the hold can fill it. That is
 * the complaint: a stretch of dark jacket, a hand across a chest, gone from the
 * mask for a frame or three and showing the room through somebody.
 */
describe("fillEnclosedHoles, holding a dropout", () => {
  const W = 14, H = 14, CAP = 3;

  /** A person filling the grid but for a one-cell border, with a 6x6 patch at `patch`. */
  function person(patch: number): Uint8ClampedArray {
    const g = new Uint8ClampedArray(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) g[y * W + x] = 255;
    for (let y = 4; y < 10; y++) for (let x = 4; x < 10; x++) g[y * W + x] = patch;
    return g;
  }
  const centre = 7 * W + 7;

  it("bridges a dropout too wide for the cap, because it was covered a frame ago", () => {
    const scratch = createStructureScratch(W * H);
    const previous = person(255);
    const now = person(40);
    const report = fillEnclosedHoles(now, W, H, CAP, scratch, previous);
    expect(now[centre]).toBe(255);
    expect(report).toEqual({ filled: 0, cells: 36, skipped: 0, held: 1 });
  });

  it("is the cap alone without a previous frame, exactly as before", () => {
    const scratch = createStructureScratch(W * H);
    const now = person(40);
    const report = fillEnclosedHoles(now, W, H, CAP, scratch);
    expect(now[centre]).toBe(40);
    expect(report.skipped).toBe(1);
    expect(report.held).toBe(0);
  });

  /**
   * The bound. Each frame's output is the next frame's `previous`, which is how
   * the rule would feed itself forever: the hold fills the patch, so the patch
   * was "covered a frame ago", so the hold fills it again. The per-cell count
   * is what ends that, and this pins the number of frames it ends after.
   */
  it("lets go after HOLE_HOLD_FRAMES frames of holding", () => {
    const scratch = createStructureScratch(W * H);
    let previous = person(255);
    const heldFor: boolean[] = [];
    for (let f = 0; f < HOLE_HOLD_FRAMES + 2; f++) {
      const now = person(40);
      fillEnclosedHoles(now, W, H, CAP, scratch, previous);
      heldFor.push(now[centre] === 255);
      previous = now;
    }
    expect(heldFor).toEqual([
      ...new Array<boolean>(HOLE_HOLD_FRAMES).fill(true),
      false,
      false,
    ]);
  });

  it("never holds a region that was never covered -- the slot between two people", () => {
    const scratch = createStructureScratch(W * H);
    // The slot was room a frame ago, and still is.
    const previous = person(0);
    const now = person(0);
    const report = fillEnclosedHoles(now, W, H, CAP, scratch, previous);
    expect(now[centre]).toBe(0);
    expect(report).toEqual({ filled: 0, cells: 0, skipped: 1, held: 0 });
  });

  /**
   * A region that merely overlaps where the person was is not a dropout. Half
   * of this patch was person a frame ago and half was always room: an arm has
   * moved and opened something. Four fifths is the line, and half is under it.
   */
  it("requires nearly all of the region to have been covered", () => {
    const scratch = createStructureScratch(W * H);
    const previous = person(255);
    for (let y = 4; y < 10; y++) for (let x = 7; x < 10; x++) previous[y * W + x] = 0;
    const now = person(40);
    const report = fillEnclosedHoles(now, W, H, CAP, scratch, previous);
    expect(now[centre]).toBe(40);
    expect(report.held).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("starts the count again once the model covers the cell itself", () => {
    const scratch = createStructureScratch(W * H);
    let previous = person(255);
    // Spend the whole hold.
    for (let f = 0; f < HOLE_HOLD_FRAMES; f++) {
      const now = person(40);
      fillEnclosedHoles(now, W, H, CAP, scratch, previous);
      previous = now;
    }
    const spent = person(40);
    fillEnclosedHoles(spent, W, H, CAP, scratch, previous);
    expect(spent[centre]).toBe(40);

    // The model finds the jacket again for one frame, then loses it again.
    const back = person(255);
    fillEnclosedHoles(back, W, H, CAP, scratch, spent);
    const again = person(40);
    const report = fillEnclosedHoles(again, W, H, CAP, scratch, back);
    expect(again[centre]).toBe(255);
    expect(report.held).toBe(1);
  });

  it("is off, not wrong, when the previous frame is the wrong size", () => {
    const scratch = createStructureScratch(W * H);
    const now = person(40);
    const report = fillEnclosedHoles(now, W, H, CAP, scratch, new Uint8ClampedArray(10));
    expect(now[centre]).toBe(40);
    expect(report.held).toBe(0);
  });

  it("is off when asked to hold for no frames", () => {
    const scratch = createStructureScratch(W * H);
    const now = person(40);
    const report = fillEnclosedHoles(now, W, H, CAP, scratch, person(255), 0);
    expect(now[centre]).toBe(40);
    expect(report.held).toBe(0);
  });
});

// ── The whole pipeline, on a built frame ─────────────────────────────────────
//
// The same harness idea as the headwear tests in backgrounds.test.ts, with the
// scene extended to the things that were complained about: a chair the person is
// sitting in, a desk across the frame they are NOT touching, a hole in the middle
// of the torso, and a corner of the room the model is faintly unsure about.

interface Frame { confidence: Float32Array; width: number; height: number }

/**
 * A 160x160 frame of somebody at a desk.
 *
 *   head + torso   confident, with a small hole in the chest the model lost
 *   headwear       a band across the top of the head at 0.28
 *   chair          a back and two arms around the torso, at 0.16 — the
 *                  confidence backgrounds.ts measured for a chair edge
 *   far shelf      a thick uncertain block in the top corner, nowhere near them
 *   wall           0.02 everywhere else
 */
function seatedFrame(opts: { chair?: number; hole?: boolean } = {}): Frame {
  const width = 160, height = 160;
  const chair = opts.chair ?? 0.16;
  const confidence = new Float32Array(width * height).fill(0.02);
  const put = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) confidence[y * width + x] = v;
    }
  };

  // The chair first, so the person is drawn over it.
  put(44, 54, 116, 150, chair);          // back
  put(30, 92, 46, 120, chair);           // left arm
  put(114, 92, 130, 120, chair);         // right arm
  // A shelf in the far corner: thick, uncertain, and nothing to do with them.
  put(6, 6, 40, 30, 0.16);
  // Head and torso.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - 80) / 22;
      const dy = (y - 62) / 26;
      if (dx * dx + dy * dy <= 1) confidence[y * width + x] = 0.96;
    }
  }
  put(58, 86, 102, 150, 0.96);           // torso
  // Forearms, out to the armrests. The armrest is only "touching" because the arm
  // reaches it — a chair arm on its own, across a gap of wall, is not.
  put(40, 92, 60, 106, 0.96);
  put(100, 92, 120, 106, 0.96);
  put(36, 32, 124, 44, 0.28);            // headwear
  // A hole in the chest: three cells across, which at this frame width is the
  // same share of a person as a logo on a 1280-wide camera.
  if (opts.hole !== false) put(76, 112, 79, 115, 0.03);
  return { confidence, width, height };
}

/** The shipped order of operations, with and without the new passes. */
function maskFor(frame: Frame, withStructure: boolean) {
  const grid = maskGrid(frame.width, frame.height);
  const coverage = new Uint8ClampedArray(grid.width * grid.height);
  sampleCoverageFromConfidence(coverage, frame.confidence, frame.width, frame.height, grid);
  quietCoverageGaps(coverage, grid.width, grid.height, maskGapSpanPx(frame.width, grid));
  if (withStructure) {
    const scratch = createStructureScratch(coverage.length);
    const reach = maskStructureReach(frame.width, grid);
    fillEnclosedHoles(coverage, grid.width, grid.height, reach.hole, scratch);
    keepTouchingStructures(coverage, grid.width, grid.height, reach, scratch);
  }
  const ceiling = dilateCeiling(new Uint8ClampedArray(coverage.length), coverage);
  dilateCoverage(coverage, grid.width, grid.height, maskDilatePx(frame.width, grid), ceiling);
  return { coverage, grid };
}

/** Average coverage over a box in frame coordinates. */
function coverageOver(
  mask: { coverage: Uint8ClampedArray; grid: ReturnType<typeof maskGrid> },
  x0: number, y0: number, x1: number, y1: number,
): number {
  const { coverage, grid } = mask;
  let sum = 0, n = 0;
  for (let y = Math.floor(y0 / grid.scale); y < Math.ceil(y1 / grid.scale); y++) {
    for (let x = Math.floor(x0 / grid.scale); x < Math.ceil(x1 / grid.scale); x++) {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      sum += coverage[y * grid.width + x];
      n++;
    }
  }
  return n ? sum / n : 0;
}

describe("somebody sitting in a chair", () => {
  const CHAIR_BACK = [48, 112, 56, 140] as const;   // beside the torso, touching it
  const CHAIR_ARM = [32, 96, 44, 108] as const;     // under the forearm, touching it
  const FAR_SHELF = [10, 10, 36, 26] as const;      // nowhere near them
  const HOLE = [76, 112, 79, 115] as const;         // inside the chest
  const HEADWEAR = [44, 34, 116, 42] as const;
  const WALL = [138, 6, 156, 24] as const;

  it("keeps the chair the person is sitting in", () => {
    const before = coverageOver(maskFor(seatedFrame(), false), ...CHAIR_BACK);
    const after = coverageOver(maskFor(seatedFrame(), true), ...CHAIR_BACK);
    expect(before).toBeLessThan(200);
    expect(after).toBeGreaterThan(240);
  });

  it("keeps the armrest under a forearm", () => {
    expect(coverageOver(maskFor(seatedFrame(), true), ...CHAIR_ARM)).toBeGreaterThan(200);
  });

  /**
   * The bound on the reveal. A thick uncertain block in the far corner of the
   * room is exactly as uncertain as the chair and is not kept, because nobody is
   * near it.
   */
  it("does not keep the furniture across the room", () => {
    expect(coverageOver(maskFor(seatedFrame(), true), ...FAR_SHELF)).toBeLessThan(20);
  });

  it("closes the hole in the middle of them", () => {
    const before = coverageOver(maskFor(seatedFrame(), false), ...HOLE);
    const after = coverageOver(maskFor(seatedFrame(), true), ...HOLE);
    expect(before).toBeLessThan(120);
    expect(after).toBeGreaterThan(240);
  });

  /** The fence. Headwear was the reason the thresholds are where they are. */
  it("still keeps headwear, and keeps it harder", () => {
    const before = coverageOver(maskFor(seatedFrame(), false), ...HEADWEAR);
    const after = coverageOver(maskFor(seatedFrame(), true), ...HEADWEAR);
    expect(before).toBeGreaterThan(200);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(CONFIDENCE_PERSON).toBeLessThanOrEqual(0.35);
    expect(coverageFromConfidence(0.28)).toBeGreaterThan(200);
  });

  it("still leaves the wall alone", () => {
    expect(coverageOver(maskFor(seatedFrame(), true), ...WALL)).toBeLessThan(20);
  });

  /**
   * A chair the model is CONFIDENT is room stays hidden, and that is the design
   * rather than a gap in it: nothing here reveals a pixel scored at zero. Said
   * out loud in a test so that a future change which starts revealing them has to
   * delete this.
   */
  it("cannot show a chair the model is sure is not a person", () => {
    const sure = seatedFrame({ chair: 0.0 });
    expect(coverageOver(maskFor(sure, true), ...CHAIR_BACK)).toBeLessThan(20);
  });

  it("does not need the solid line to be a magic number", () => {
    // Everything above reads "the person" as this one value, so it is named here:
    // a change to it changes which cells can anchor a structure and which count as
    // a hole's wall.
    expect(STRUCTURE_SOLID).toBeGreaterThan(128);
    expect(STRUCTURE_SOLID).toBeLessThan(255);
  });
});

// ── Firmness ─────────────────────────────────────────────────────────────────
//
// "No spots and no flicker when people move" is two faults with one shape: a cell
// that disagrees with its neighbours, and a cell that disagrees with its own
// recent past. One median each.

describe("despeckleCoverage", () => {
  const scratch = createStructureScratch(32 * 32);

  const run = (rows: number[][]) => {
    const g = gridOf(rows);
    despeckleCoverage(g.coverage, g.width, g.height, scratch);
    return g;
  };

  it("deletes a lone covered cell in the middle of the room", () => {
    const g = run([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 255, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(at(g, 2, 2)).toBe(0);
  });

  it("closes a lone pinhole in the middle of a person", () => {
    // Ninety of these a frame, measured — a pixel of room blinking inside
    // somebody's chest.
    const g = run([
      [255, 255, 255, 255, 255],
      [255, 255, 255, 255, 255],
      [255, 255, 0, 255, 255],
      [255, 255, 255, 255, 255],
      [255, 255, 255, 255, 255],
    ]);
    expect(at(g, 2, 2)).toBe(255);
  });

  /**
   * The reason this is a cross and not a plain separable median. A line one cell
   * wide is a thin braid, a lanyard, a microphone boom — at this grid a cell is
   * about 2.7px of a 720p frame. A median taken across the line alone deletes it;
   * the median OF the two axis medians keeps it, because it wins along its own
   * axis.
   */
  it("keeps a line one cell wide, in either direction", () => {
    const down = run([
      [0, 0, 255, 0, 0],
      [0, 0, 255, 0, 0],
      [0, 0, 255, 0, 0],
      [0, 0, 255, 0, 0],
      [0, 0, 255, 0, 0],
    ]);
    expect(at(down, 2, 2)).toBe(255);

    const across = run([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [255, 255, 255, 255, 255],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(at(across, 2, 2)).toBe(255);
  });

  it("leaves a straight edge exactly where it was", () => {
    const g = run([
      [0, 0, 255, 255, 255],
      [0, 0, 255, 255, 255],
      [0, 0, 255, 255, 255],
      [0, 0, 255, 255, 255],
      [0, 0, 255, 255, 255],
    ]);
    for (let y = 1; y < 4; y++) {
      expect(at(g, 1, y)).toBe(0);
      expect(at(g, 2, y)).toBe(255);
    }
  });

  /**
   * And leaves a RAMP alone, which is the property the compositor's feathering
   * depends on: the median of three points on a slope is the middle one, so the
   * soft edge that makes hair read as hair survives this pass untouched.
   */
  it("leaves a graded ramp alone", () => {
    const g = run([
      [0, 40, 90, 140, 190],
      [0, 40, 90, 140, 190],
      [0, 40, 90, 140, 190],
      [0, 40, 90, 140, 190],
      [0, 40, 90, 140, 190],
    ]);
    expect([at(g, 1, 2), at(g, 2, 2), at(g, 3, 2)]).toEqual([40, 90, 140]);
  });

  it("refuses a grid too small to have a middle", () => {
    const g = gridOf([[255, 0], [0, 255]]);
    despeckleCoverage(g.coverage, g.width, g.height, scratch);
    expect([...g.coverage]).toEqual([255, 0, 0, 255]);
  });
});

describe("steadyCoverage", () => {
  const frame = (v: number[]) => new Uint8ClampedArray(v);

  it("passes the first two frames through, rather than fading a person in", () => {
    const w = createTemporalWindow(3);
    expect([...steadyCoverage(frame([255, 255, 255]), w)]).toEqual([255, 255, 255]);
    expect([...steadyCoverage(frame([255, 255, 255]), w)]).toEqual([255, 255, 255]);
  });

  /**
   * The fault, exactly: one frame in which the model changed its mind about a cell
   * and changed it back. The blend cannot catch this — the first significant change
   * on a pixel is treated as movement by design, because treating it as noise is
   * how a mask starts lagging a person.
   */
  /**
   * TWO frames pass through, not one. With only the first exempt, the second
   * frame's median is taken against a buffer of zeros — which for a graded cell
   * returns the frame BEFORE it rather than the frame itself, so the opening of
   * every call carries one frame of somebody's edge from the frame before.
   */
  it("passes the second frame through as itself, not as a median against nothing", () => {
    const w = createTemporalWindow(1);
    expect([...steadyCoverage(frame([100]), w)]).toEqual([100]);
    expect([...steadyCoverage(frame([200]), w)]).toEqual([200]);
  });

  it("deletes a one-frame excursion", () => {
    const w = createTemporalWindow(1);
    steadyCoverage(frame([255]), w);
    steadyCoverage(frame([255]), w);
    expect([...steadyCoverage(frame([0]), w)]).toEqual([255]);
    // And the frame after it, when the model has gone back to agreeing.
    expect([...steadyCoverage(frame([255]), w)]).toEqual([255]);
  });

  it("lets a change that lasts through, on its second frame", () => {
    const w = createTemporalWindow(1);
    steadyCoverage(frame([255]), w);
    steadyCoverage(frame([255]), w);
    // First frame of a real move: held back, which is the one frame this costs.
    expect([...steadyCoverage(frame([0]), w)]).toEqual([255]);
    // Second frame: through.
    expect([...steadyCoverage(frame([0]), w)]).toEqual([0]);
  });

  /**
   * The window records what the model SAID, not what this rule decided. Keeping
   * medians of medians would compound frame on frame into a mask that stopped
   * moving at all — the same trap `sharpenEdge` avoids by not writing back into
   * the blend's history.
   */
  it("remembers the raw frames, not its own answers", () => {
    const w = createTemporalWindow(1);
    steadyCoverage(frame([0]), w);
    steadyCoverage(frame([0]), w);
    steadyCoverage(frame([255]), w);   // held: median(0, 0, 255) = 0
    steadyCoverage(frame([255]), w);   // median(0, 255, 255) = 255
    expect([...steadyCoverage(frame([255]), w)]).toEqual([255]);
  });

  it("holds a cell that keeps changing its mind at the value it mostly has", () => {
    const w = createTemporalWindow(1);
    steadyCoverage(frame([255]), w);
    steadyCoverage(frame([255]), w);
    const seen: number[] = [];
    for (const v of [0, 255, 0, 255, 0]) seen.push(steadyCoverage(frame([v]), w)[0]);
    // Alternating input, and nothing alternating comes out of the median.
    expect(seen.filter((v) => v === 255).length).toBeGreaterThanOrEqual(3);
  });
});
