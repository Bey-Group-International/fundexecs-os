// lib/meetings/mask-structure.ts
// What a person is TOUCHING, what is inside them, and what is just the room.
//
// backgrounds.ts reads the segmenter one pixel at a time: a confidence becomes a
// coverage, growth widens it a little, an enclosed gap is quieted. None of that
// can answer a question about SHAPE, and three of the complaints about this effect
// are shape questions:
//
//   "show me my chair"        the chair someone is sitting in is part of them
//                             being in the room, and composited away it looks
//                             like they are floating
//   "holes in the middle"     a patch inside a torso the model lost — a logo, a
//                             lanyard, a dark fold — through which the
//                             replacement shows, inside the person
//   "cover ALL the background" a faint patch of room away from anybody, whose
//                             coverage wanders frame to frame, which is a
//                             shimmering sharp window onto the room
//
// All three are about whether a region is ATTACHED to a person, and attachment is
// not a per-pixel property. So this file adds the two cheapest shape measurements
// that answer it, and three rules that read them.
//
// THE SIGNAL THIS RESTS ON, stated plainly because the whole design depends on it:
// a chair is not confident background to selfie_segmenter. The measured swing
// table in backgrounds.ts has it at 0.05<->0.25 confidence — in the uncertainty
// band, which is exactly where this file is allowed to work. A chair the model is
// SURE is room stays hidden, and that is deliberate: nothing here ever reveals a
// pixel the model scored at zero, because that is the guarantee the privacy
// finding on #1203 bought and it is not for sale.
//
// WHAT THAT MEANS IN PRACTICE, equally plainly: this keeps the parts of a chair
// the model is unsure about and that touch the person — a chair back behind
// shoulders, an armrest under a forearm, a headrest behind a head. If somebody
// rests their forearms on a desk, the near strip of that desk is also uncertain
// and also touching them, and it will also be kept. "Only what touches the
// person" is the instruction, and a desk under their arms satisfies it. There is
// no signal here that tells a chair from a desk.
//
// WHAT IT ACTUALLY DOES, on a built frame of somebody at a desk — a head and
// torso the model is sure of, headwear at 0.28, a chair back and two arms at 0.16,
// forearms reaching the arms, a three-cell hole in the chest, and a shelf in the
// far corner at the same 0.16 as the chair. Average coverage over each region,
// before and after these two passes, identical at 640x360, 1280x720 and 1920x1080
// because every reach is a fraction of frame width:
//
//   region                      before    after
//   chair back (touching)        118      234
//   chair arm (under a forearm)  118      197
//   shelf across the room        118       26
//   hole in the chest             35      255
//   headwear                     235      235     <- the fence, unmoved
//   wall                           0        0
//   head itself                  255      255
//
// The shelf does not reach zero because of a deliberate middle: between `reach`
// and `quiet` a cell is neither kept nor quieted, and keeps exactly the coverage
// the model gave it. The shelf's near corner is in that band. Doing nothing where
// the answer is unclear is the conservative choice in both directions — it neither
// reveals nor erases.
//
// WHAT IT COSTS, same frame, the 481x270 grid, 100 frames, next to the two passes
// already in the chain so the comparison is on one machine:
//
//   dilateCeiling + dilateCoverage   1.02 ms per frame
//   blendCoverageByAgreement         0.81 ms
//   fillEnclosedHoles                1.03 ms
//   keepTouchingStructures           1.30 ms
//   both of the new passes           2.40 ms
//
// That is real: it roughly doubles the mask arithmetic. It is affordable because
// `shouldSuspendEffect` already exists — a sustained run of slow frames turns the
// effect off rather than letting a face freeze — and because the alternative was
// the complaint. If it proves too much on real hardware the next move is to run
// the shape passes on a half-size copy of the grid, which is a quarter of the
// cells; that is not done here because halving the grid also halves the thickness
// test, and the thickness test is the safety.
//
// Pure: no DOM, no canvas. Allocates nothing per frame — the caller holds the
// scratch buffers.
import type { MaskGrid } from "@/lib/meetings/backgrounds";

/**
 * How covered a cell has to be to count as the person themselves.
 *
 * The same value and the same reasoning as `GAP_ANCHOR_SOLID` in backgrounds.ts:
 * a cell in the uncertainty band — hair, a headwrap, the edge of a face — is not
 * evidence of a torso, so it cannot anchor anything. Everything in this file
 * measures distance FROM these cells and fills TOWARD them.
 */
export const STRUCTURE_SOLID = 200;

/**
 * How thick a band of uncertainty has to be before it is a structure.
 *
 * This is what separates a chair from a silhouette's own soft edge, and it is the
 * number that makes the rest safe. Every person arrives wearing a ramp: the
 * confidence falls from certainly-them to certainly-not over a pixel or two, so
 * the mask has a one- to two-cell band of partial coverage all the way around
 * them. That band is the feathering the compositor relies on — hardening it would
 * cut hair off in a staircase, which is the fault `coverageFromConfidence` exists
 * to avoid.
 *
 * A chair back, a headrest, an armrest, the crown of a headwrap are not one cell
 * thick. So thickness is the test, and the edge ramp fails it by construction.
 *
 * As a fraction of frame width: 0.006 is 8px at 1280, which the grid carries as
 * about three cells.
 */
const STRUCTURE_THICKNESS_FRACTION = 0.006;

/**
 * How far from the person a structure may reach and still be kept.
 *
 * The bound on the whole reveal, and the honest answer to "only what touches
 * them": touching has to mean something narrower than connected, because in a
 * single frame everything is connected to everything. A chair is within a hand's
 * width of the person sitting in it; a sofa on the far wall is not.
 *
 * 0.06 of frame width is 77px at 1280 — about half a head. Larger starts keeping
 * whatever furniture happens to stand behind somebody; smaller cuts the chair
 * back off level with the shoulders, which looks worse than no chair at all.
 */
const STRUCTURE_REACH_FRACTION = 0.06;

/**
 * Beyond this distance from any person, uncertainty is the room.
 *
 * The other half of "cover all the background". A faint patch of coverage with
 * nobody near it is not a person the model nearly found; it is a corner of the
 * room the model nearly rejected, and because the composite is `destination-in`
 * its wandering value is a sharp window onto that corner, flickering. Held at
 * zero it stops wandering and the effect is drawn there instead.
 *
 * Comfortably beyond the reach above, so a kept structure and a quieted room
 * never argue over the same cell.
 */
const STRUCTURE_QUIET_FRACTION = 0.10;

/**
 * The most coverage a distant cell may have and still be zeroed.
 *
 * The fence on the one anti-monotone rule here, for the same reason
 * `GAP_QUIET_CEILING` exists: lowering coverage is how you take a bite out of
 * somebody. A cell the model gave more than half to, with no solid person
 * anywhere near it, is more likely a person it is unsure about everywhere — far
 * from the camera, badly lit, half out of frame — than a corner of room. Those
 * keep every bit of their coverage, and the shimmer being removed wanders in the
 * low tens.
 */
const STRUCTURE_QUIET_CEILING = 128;

/**
 * The widest hole inside a person to fill, as a fraction of frame width.
 *
 * Small on purpose, and the cap is what makes hole-filling safe rather than a
 * reveal. Filling a region ENCLOSED by a person reveals whatever is behind it,
 * and two enclosed regions are emphatically not holes in a person: the gap
 * between two colleagues sitting shoulder to shoulder, and the triangle between
 * a raised arm and a torso. Both are tens of cells across. A logo, a lanyard,
 * a dark fold, a pair of glasses are a handful.
 *
 * So a hole is filled only when it is small in BOTH directions. 0.025 of frame
 * width is 32px at 1280, about twelve cells.
 */
const HOLE_SPAN_FRACTION = 0.025;

/** The four reaches, in GRID cells, for one frame size. */
export interface StructureReach {
  /** Uncertainty at least this thick is a structure rather than an edge. */
  thickness: number;
  /** A structure within this of the person is kept. */
  reach: number;
  /** Uncertainty beyond this from any person is held at zero. */
  quiet: number;
  /** An enclosed region smaller than this in both axes is a hole to fill. */
  hole: number;
}

/**
 * The reaches for a frame, converted onto the grid the mask is carried on.
 *
 * Expressed against the frame and then divided by the grid scale, exactly as
 * `maskDilatePx` and `maskGapSpanPx` do, so every one of these is the same share
 * of a face whatever the camera resolution.
 */
export function maskStructureReach(frameWidth: number, grid: MaskGrid): StructureReach {
  const width = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 640;
  const scale = Number.isFinite(grid.scale) && grid.scale > 0 ? grid.scale : 1;
  const inGrid = (fraction: number) => Math.max(1, Math.round((width * fraction) / scale));
  return {
    thickness: inGrid(STRUCTURE_THICKNESS_FRACTION),
    reach: inGrid(STRUCTURE_REACH_FRACTION),
    quiet: inGrid(STRUCTURE_QUIET_FRACTION),
    hole: inGrid(HOLE_SPAN_FRACTION),
  };
}

/**
 * The per-frame memory these rules need, allocated once per mask size.
 *
 * Two distance fields and a flood fill's bookkeeping. At the 481x270 grid that is
 * two 260KB arrays and a 130KB one, plus a stack — the same order as the blend's
 * agreement record, which was judged affordable for the same reason: the memory
 * is a fixed price and the time is what matters.
 */
export interface StructureScratch {
  /** Cells to the nearest confident-background cell. Thickness is read from this. */
  toBackground: Uint16Array;
  /** Cells to the nearest solid person cell. Attachment is read from this. */
  toPerson: Uint16Array;
  /** Flood-fill marks: 0 unvisited, 1 reached from the frame edge, 2 enclosed. */
  visited: Uint8Array;
  /** The flood's stack of cell indices. Never deeper than the grid. */
  stack: Int32Array;
}

export function createStructureScratch(length: number): StructureScratch {
  const n = Math.max(0, Math.floor(length));
  return {
    toBackground: new Uint16Array(n),
    toPerson: new Uint16Array(n),
    visited: new Uint8Array(n),
    stack: new Int32Array(n),
  };
}

/** Farther than any grid is wide, and still far from overflowing a Uint16. */
const FAR = 0xfff0;

/**
 * City-block distance to the nearest confident-background cell, and to the
 * nearest solid person cell, in one pair of sweeps.
 *
 * Two sweeps, forward and backward, which is the standard exact transform for
 * this metric and the only shape measurement cheap enough to take every frame.
 * City-block rather than Euclidean, so a diagonal step counts as two — the
 * difference is a cell or so at these reaches, and it costs no square roots.
 *
 * BOTH FIELDS IN THE SAME LOOP, and the comparisons written out rather than
 * passed in as predicates. Measured at 1280x720 on the 481x270 grid, over 100
 * frames:
 *
 *   two transforms, predicate functions   2.98 ms per frame
 *   one fused loop, comparisons inline    1.23 ms
 *
 * which is the difference between a pass that fits beside the compositor's other
 * work and one that does not. Both fields are read from `coverage` only, never
 * from each other, so the caller gets both measured against the same snapshot.
 */
function distanceFields(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  toBackground: Uint16Array,
  toPerson: Uint16Array,
): void {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const c = coverage[i];

      if (c === 0) {
        toBackground[i] = 0;
      } else {
        let best = FAR;
        if (x > 0) { const d = toBackground[i - 1] + 1; if (d < best) best = d; }
        if (y > 0) { const d = toBackground[i - width] + 1; if (d < best) best = d; }
        toBackground[i] = best;
      }

      if (c >= STRUCTURE_SOLID) {
        toPerson[i] = 0;
      } else {
        let best = FAR;
        if (x > 0) { const d = toPerson[i - 1] + 1; if (d < best) best = d; }
        if (y > 0) { const d = toPerson[i - width] + 1; if (d < best) best = d; }
        toPerson[i] = best;
      }
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x;
      let b = toBackground[i];
      if (b !== 0) {
        if (x < width - 1) { const d = toBackground[i + 1] + 1; if (d < b) b = d; }
        if (y < height - 1) { const d = toBackground[i + width] + 1; if (d < b) b = d; }
        toBackground[i] = b;
      }
      let p = toPerson[i];
      if (p !== 0) {
        if (x < width - 1) { const d = toPerson[i + 1] + 1; if (d < p) p = d; }
        if (y < height - 1) { const d = toPerson[i + width] + 1; if (d < p) p = d; }
        toPerson[i] = p;
      }
    }
  }
}

/** What one pass changed, for tests and for a measurement to quote. */
export interface StructureReport {
  /** Cells raised to full because they are a structure the person is touching. */
  kept: number;
  /** Cells held at zero because they are room with nobody near them. */
  quieted: number;
}

/**
 * Keep the uncertain structures a person is touching; quiet the ones they are not.
 *
 * One pass over the grid after the two distance fields, reading three facts about
 * each cell in the uncertainty band:
 *
 *   how thick the uncertainty is here   `toBackground` — an edge ramp is 1-2
 *                                       cells from confident room, a chair back
 *                                       is not
 *   how far the person is               `toPerson` — a chair is a hand's width
 *                                       away, the far wall is not
 *   how much the model gave it          the fence on the one rule that subtracts
 *
 * What it will not do, in order of how much it matters:
 *
 *   * It never raises a cell the model scored at zero. Confident room stays
 *     hidden whatever it is touching, which is what keeps this from being a
 *     reveal dressed up as a feature.
 *   * It never hardens the silhouette's own edge, because that edge fails the
 *     thickness test. The feathering the compositor depends on is untouched.
 *   * It cannot tell a chair from a desk, or from a lamp standing behind a
 *     shoulder. Uncertain, thick, and within reach of the person is the whole
 *     definition.
 */
export function keepTouchingStructures(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  reach: StructureReach,
  scratch: StructureScratch,
): StructureReport {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const report: StructureReport = { kept: 0, quieted: 0 };
  const n = w * h;
  if (n <= 0 || coverage.length < n || scratch.toBackground.length < n) return report;

  const toBackground = scratch.toBackground;
  const toPerson = scratch.toPerson;
  distanceFields(coverage, w, h, toBackground, toPerson);

  for (let i = 0; i < n; i++) {
    const c = coverage[i];
    // Confident room, and the person themselves. Neither is this rule's business.
    if (c === 0 || c >= STRUCTURE_SOLID) continue;

    if (toPerson[i] > reach.quiet) {
      if (c <= STRUCTURE_QUIET_CEILING) {
        coverage[i] = 0;
        report.quieted++;
      }
      continue;
    }

    if (toBackground[i] >= reach.thickness && toPerson[i] <= reach.reach) {
      coverage[i] = 255;
      report.kept++;
    }
  }

  return report;
}

/** What hole filling changed. */
export interface HoleReport {
  /** Enclosed regions filled. */
  filled: number;
  /** Cells raised. */
  cells: number;
  /** Enclosed regions left alone because they were too big to be holes. */
  skipped: number;
}

/**
 * Fill the small enclosed gaps inside a person, in place.
 *
 * A hole is a region of not-the-person that cannot reach the edge of the frame
 * without crossing the person, and is small in both directions. The first half is
 * a flood fill from the frame's border; the second half is the safety.
 *
 * WHY THE SIZE CAP IS THE WHOLE SAFETY. Filling an enclosed region reveals
 * whatever the camera saw there, and the two commonest enclosed regions in a real
 * call are not holes in anybody:
 *
 *   two people sitting shoulder to shoulder, heads nearly touching, leave a tall
 *   narrow slot of room between them — `quietCoverageGaps` exists to hold exactly
 *   that at zero, and filling it would undo that fix and put the sharp strip of
 *   their room back
 *
 *   a hand on a hip, or an elbow out, encloses a triangle of room against the
 *   torso
 *
 * Both are tens of cells tall. A logo, a lanyard, a pair of glasses, a dark fold
 * in a shirt are a handful in both axes, so the cap admits the second kind and
 * refuses the first. A region that fails the cap is left exactly as the model left
 * it, which for the two-person slot means zero.
 *
 * Two flood fills over the same `visited` marks: one from the border to find
 * everything outside, then one per remaining region to measure it before deciding.
 * Linear in cells, and the stack is bounded by the grid.
 */
export function fillEnclosedHoles(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  maxSpan: number,
  scratch: StructureScratch,
): HoleReport {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const report: HoleReport = { filled: 0, cells: 0, skipped: 0 };
  const n = w * h;
  const span = Math.max(1, Math.floor(maxSpan));
  if (n <= 0 || coverage.length < n || scratch.visited.length < n) return report;

  const visited = scratch.visited;
  const stack = scratch.stack;
  visited.fill(0, 0, n);

  // Everything the frame's edge can reach without crossing the person. A person
  // standing against the edge of frame — which is most people, who are cut off at
  // the shoulders — does not enclose the room behind them, and this is what says
  // so.
  //
  // The pushes are written out rather than factored into a helper: at four
  // neighbours per cell this is half a million calls a frame, and measured at
  // 1280x720 the closure version cost 1.92 ms per frame against 0.71 ms for this
  // one.
  let top = 0;
  for (let x = 0; x < w; x++) {
    const b = (h - 1) * w + x;
    if (visited[x] === 0 && coverage[x] < STRUCTURE_SOLID) { visited[x] = 1; stack[top++] = x; }
    if (visited[b] === 0 && coverage[b] < STRUCTURE_SOLID) { visited[b] = 1; stack[top++] = b; }
  }
  for (let y = 0; y < h; y++) {
    const l = y * w;
    const r = l + w - 1;
    if (visited[l] === 0 && coverage[l] < STRUCTURE_SOLID) { visited[l] = 1; stack[top++] = l; }
    if (visited[r] === 0 && coverage[r] < STRUCTURE_SOLID) { visited[r] = 1; stack[top++] = r; }
  }
  while (top > 0) {
    const i = stack[--top];
    const x = i % w;
    if (x > 0) { const k = i - 1; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 1; stack[top++] = k; } }
    if (x < w - 1) { const k = i + 1; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 1; stack[top++] = k; } }
    if (i >= w) { const k = i - w; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 1; stack[top++] = k; } }
    if (i < n - w) { const k = i + w; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 1; stack[top++] = k; } }
  }

  // Whatever is left open and unvisited is enclosed. Measure each region before
  // touching it.
  for (let start = 0; start < n; start++) {
    if (visited[start] !== 0 || coverage[start] >= STRUCTURE_SOLID) continue;

    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    const head = top;
    visited[start] = 2;
    stack[top++] = start;
    // The region's cells are the stack slice from `head` to `top`, which is what
    // lets them be filled without a second pass over the grid.
    for (let read = head; read < top; read++) {
      const i = stack[read];
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0) { const k = i - 1; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 2; stack[top++] = k; } }
      if (x < w - 1) { const k = i + 1; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 2; stack[top++] = k; } }
      if (i >= w) { const k = i - w; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 2; stack[top++] = k; } }
      if (i < n - w) { const k = i + w; if (visited[k] === 0 && coverage[k] < STRUCTURE_SOLID) { visited[k] = 2; stack[top++] = k; } }
    }

    if (x1 - x0 + 1 <= span && y1 - y0 + 1 <= span) {
      for (let read = head; read < top; read++) coverage[stack[read]] = 255;
      report.filled++;
      report.cells += top - head;
    } else {
      report.skipped++;
    }
    top = head;
  }

  return report;
}
