// lib/meetings/control-bar-fit.ts
// Which of the call's controls keep a button on the bar, and which fold into
// "More".
//
// WHAT WAS MEASURED, because the first version of this comment guessed and the
// guess was wrong. Chromium, the busiest bar there is (a host, recording, on a
// degraded link, with people waiting, unread chat and a hand up), every width
// from 320px to 1600px in 20px steps:
//
//   320px, 340px   the exit hangs off the right edge — 14px for a guest, 30px
//                  for a host, whose exit is two parts
//   360px upward   nothing off screen, for either of them
//
// So the breakpoints were doing their job above 360px, which the bar's own code
// says was the target ("42px wide, which is what lets a host's whole bar fit a
// 360px screen"). The arithmetic this file used to open with — fourteen controls
// and a two-part exit coming to 1030px inside a 1024px window — was a model of a
// bar that does not exist, because `hidden lg:flex` had already taken four of
// those controls away at that width. It is deleted rather than corrected.
//
// WHAT IS STILL WRONG, and why this exists anyway:
//
//   * 320px and 340px are real phones, and the control hanging off them is the
//     one somebody reaches for when they want out of a meeting. No breakpoint can
//     fix it, because the exit, the mic and the camera never fold.
//   * A breakpoint measures the WINDOW. The row gets what is left after the
//     recording pill, the degraded-link notice and the exit, and those come and
//     go during a call: a width that fit a minute ago does not fit now. The
//     measured sweep above is one state of the bar out of many.
//   * `xl` gives every button a text label and a wider minimum at the same width
//     that reveals more of them, so the breakpoints work against themselves
//     exactly where they are most crowded.
//
// Every button is `shrink-0` and the row is `justify-center` with no scrolling,
// so the overflow does not compress, wrap or scroll: it hangs off BOTH ends of
// the bar, past the edge of the window, where it cannot be clicked. Centring is
// what makes it lose controls at both ends rather than one.
//
// So the row is measured and the decision made from the measurement, with the
// breakpoints kept underneath it as the floor that needs no JavaScript — see
// BAR_AT_WIDTH in CallParts.tsx for that half, and ControlBar.fold.visual.test.ts
// for the only test that can see this working, because a fold is a measurement
// and jsdom measures nothing.
//
// Folding is not hiding: a folded control keeps its full behaviour inside More,
// and `foldedBadgeTotal` is what stops folding something hiding the number it was
// carrying.
//
// Pure: no DOM, no React. The bar measures and asks.

/** A control that may give up its place on the bar. Mic, camera and the exit never do. */
export type BarFeature =
  | "background"
  | "share"
  | "hand"
  | "react"
  | "layout"
  | "record"
  | "chat"
  | "people"
  | "docs";

/**
 * The order the controls appear in on the bar.
 *
 * Display order, not priority. Folding must not reshuffle what is left, or the
 * bar rearranges itself as the window moves and nothing stays where somebody
 * reached for it last.
 */
export const BAR_ORDER: readonly BarFeature[] = [
  "background",
  "share",
  "hand",
  "react",
  "layout",
  "record",
  "chat",
  "people",
  "docs",
];

/**
 * The order in which controls EARN their place. First here is last to fold.
 *
 * Ranked by what is lost by moving it one press away, which is not the same as
 * how often it is used:
 *
 * `chat` and `people` lead because they are the two that carry live numbers —
 * unread messages, and somebody waiting at the door. A control behind a menu can
 * still be reached; a number behind a menu is a number nobody sees. (They are
 * not unfoldable, because at some width everything must go; `foldedBadgeTotal`
 * is what keeps their news visible when they do.)
 *
 * `share` and `record` next: both are mid-sentence actions. Fumbling for a menu
 * while saying "let me show you" is the cost, and for `record` a late press is
 * meeting that was not captured.
 *
 * `hand` then `background`: raising a hand is time-sensitive but infrequent, and
 * a background is almost always chosen once in the green room and never touched.
 *
 * `docs`, `react`, `layout` fold first. All three are deliberate, unhurried
 * choices where a menu costs nothing but the press.
 */
export const KEEP_PRIORITY: readonly BarFeature[] = [
  "chat",
  "people",
  "share",
  "record",
  "hand",
  "background",
  "docs",
  "react",
  "layout",
];

export interface BarFit {
  /** Controls keeping their own button, in `BAR_ORDER`. */
  inBar: BarFeature[];
  /** Controls now inside More, in `BAR_ORDER`. */
  folded: BarFeature[];
}

/**
 * How many optional controls fit.
 *
 * `reserved` is everything that is not an optional control and cannot be folded
 * — the mic and camera with their chevrons, the More button itself, the exit,
 * and whatever the left-hand side is currently showing. Subtracting it is the
 * whole point: the row's own width tells you nothing about how much of it is
 * already spoken for.
 *
 * Returns a count, not a set, so the ranking below is the only thing deciding
 * WHICH controls fill it.
 */
export function barCapacity(input: {
  /** The feature row's width in px. */
  available: number;
  /** Width of one control including the gap that follows it, in px. */
  itemWidth: number;
  /** Width already committed to controls that never fold, in px. */
  reserved: number;
}): number {
  const { available, itemWidth, reserved } = input;
  if (!Number.isFinite(available) || !Number.isFinite(itemWidth) || !Number.isFinite(reserved)) return 0;
  if (itemWidth <= 0) return 0;
  const room = available - Math.max(0, reserved);
  if (room <= 0) return 0;
  return Math.max(0, Math.floor(room / itemWidth));
}

/**
 * Split the offered controls into the ones that stay and the ones that fold.
 *
 * `offered` is what this call actually has — host-only controls, a screen share
 * a phone cannot do, documents a guest may not reach — already decided
 * elsewhere. Nothing here puts a control on the bar that the call does not have.
 *
 * A capacity that cannot be computed yet (the row has not been measured) folds
 * NOTHING, so the first paint looks like the bar always did and the measurement
 * corrects it a frame later. The other way round — fold everything until proven
 * otherwise — flashes an almost empty bar on every join, which looks like a
 * broken room rather than a narrow one.
 */
export function fitBar(input: {
  offered: readonly BarFeature[];
  /** From `barCapacity`, or null while the row is unmeasured. */
  capacity: number | null;
}): BarFit {
  const offered = BAR_ORDER.filter((f) => input.offered.includes(f));
  if (input.capacity === null || !Number.isFinite(input.capacity)) {
    return { inBar: offered, folded: [] };
  }

  const room = Math.max(0, Math.floor(input.capacity));
  const kept = new Set(KEEP_PRIORITY.filter((f) => offered.includes(f)).slice(0, room));
  return {
    inBar: offered.filter((f) => kept.has(f)),
    folded: offered.filter((f) => !kept.has(f)),
  };
}

/**
 * The number to show on the More button, given what folded.
 *
 * Folding a control must not fold the news it was carrying. Chat's unread count
 * and the number of people waiting at the door are the reason somebody looks at
 * the bar at all, and a control that keeps its badge only while it happens to
 * have a button is a control that goes quiet exactly when the bar is most
 * crowded.
 *
 * Summed rather than listed: one number on one button is what the space allows,
 * and "there are four things in here wanting you" is the useful part. Zero
 * returns null so the caller draws no badge rather than a badge reading "0".
 */
export function foldedBadgeTotal(
  folded: readonly BarFeature[],
  badges: Partial<Record<BarFeature, number>>,
): number | null {
  let total = 0;
  for (const feature of folded) {
    const n = badges[feature];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total > 0 ? total : null;
}
