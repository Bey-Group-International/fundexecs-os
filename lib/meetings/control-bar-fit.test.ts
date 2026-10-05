// Folding the call's controls into "More" when the bar runs out of room.
//
// The failure being fixed is not cosmetic: every bar button is `shrink-0` and the
// row is `justify-center` with no scrolling, so controls that do not fit hang off
// both ends of the bar, past the window edge, unclickable. Centring is why it
// loses them at both ends at once. Measured in Chromium, a host's exit hangs 30px
// off a 320px phone — and the exit is the one control that can never fold.
//
// This file tests the arithmetic only. Whether the bar then fits is a question for
// a layout engine, and lives in app/(app)/meetings/[roomId]/ControlBar.fold.visual.test.ts.

import {
  BAR_ORDER,
  KEEP_PRIORITY,
  barCapacity,
  fitBar,
  foldedBadgeTotal,
  type BarFeature,
} from "@/lib/meetings/control-bar-fit";

const ALL = [...BAR_ORDER];

describe("barCapacity", () => {
  it("counts how many whole controls the leftover room holds", () => {
    // 400px of row, 100px already committed, 50px a control: six fit.
    expect(barCapacity({ available: 400, itemWidth: 50, reserved: 100 })).toBe(6);
  });

  /**
   * The whole reason this is measured rather than inferred from a breakpoint: the
   * row's width says nothing about how much of it the mic, camera, More button
   * and the exit have already taken.
   */
  it("subtracts what the unfoldable controls have already taken", () => {
    const ignoringReserved = barCapacity({ available: 600, itemWidth: 50, reserved: 0 });
    const honest = barCapacity({ available: 600, itemWidth: 50, reserved: 300 });
    expect(ignoringReserved).toBe(12);
    expect(honest).toBe(6);
  });

  it("never reports a partial control as fitting", () => {
    // 149px of room at 50px each is two, not two-and-a-bit: a control drawn
    // 49px short of the edge is the bug, not the fix.
    expect(barCapacity({ available: 149, itemWidth: 50, reserved: 0 })).toBe(2);
  });

  it("reports nothing fits when there is no room, rather than a negative", () => {
    expect(barCapacity({ available: 100, itemWidth: 50, reserved: 400 })).toBe(0);
    expect(barCapacity({ available: 0, itemWidth: 50, reserved: 0 })).toBe(0);
  });

  it("refuses nonsense measurements instead of dividing by them", () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(barCapacity({ available: 600, itemWidth: bad, reserved: 0 })).toBe(0);
    }
    expect(barCapacity({ available: Number.NaN, itemWidth: 50, reserved: 0 })).toBe(0);
  });
});

describe("fitBar", () => {
  /**
   * Before the row has been measured there is nothing to decide from. Showing
   * everything means one frame that looks like the bar always did; the
   * alternative — fold everything until proven otherwise — flashes a nearly
   * empty bar on every single join, which reads as a broken room rather than a
   * narrow one.
   */
  it("folds nothing while the row is still unmeasured", () => {
    const fit = fitBar({ offered: ALL, capacity: null });
    expect(fit.inBar).toEqual(ALL);
    expect(fit.folded).toEqual([]);
  });

  it("keeps everything when everything fits", () => {
    const fit = fitBar({ offered: ALL, capacity: ALL.length });
    expect(fit.folded).toEqual([]);
    expect(fit.inBar).toEqual(ALL);
  });

  it("folds the surplus and nothing more", () => {
    const fit = fitBar({ offered: ALL, capacity: ALL.length - 2 });
    expect(fit.folded).toHaveLength(2);
    expect(fit.inBar).toHaveLength(ALL.length - 2);
  });

  /**
   * The two that carry live numbers go last. A control behind a menu can still
   * be reached; a NUMBER behind a menu is a number nobody sees, and unread chat
   * and somebody waiting at the door are the reasons to look at the bar at all.
   */
  it("gives up the deliberate controls before the ones carrying news", () => {
    const fit = fitBar({ offered: ALL, capacity: 2 });
    expect(fit.inBar).toEqual(["chat", "people"]);
    expect(fit.folded).toContain("layout");
    expect(fit.folded).toContain("react");
  });

  it("folds layout first and share late", () => {
    const first = fitBar({ offered: ALL, capacity: ALL.length - 1 }).folded;
    expect(first).toEqual(["layout"]);
    // Share survives until most of the bar has gone.
    expect(fitBar({ offered: ALL, capacity: 3 }).inBar).toContain("share");
  });

  /**
   * Display order is not priority order. If folding reshuffled what was left,
   * the bar would rearrange itself as the window moved and nothing would stay
   * where somebody reached for it a moment ago.
   */
  it("leaves the surviving controls in their bar order, not their priority order", () => {
    const fit = fitBar({ offered: ALL, capacity: 4 });
    const expected = BAR_ORDER.filter((f) => fit.inBar.includes(f));
    expect(fit.inBar).toEqual(expected);
    // Priority would have put chat and people first; bar order does not.
    expect(fit.inBar[0]).not.toBe("chat");
  });

  it("puts nothing on the bar that this call does not have", () => {
    // A guest has no documents and no recording; a phone has no screen share.
    const offered: BarFeature[] = ["hand", "react", "chat", "people"];
    const fit = fitBar({ offered, capacity: 99 });
    expect(fit.inBar).toEqual(["hand", "react", "chat", "people"]);
    expect(fit.folded).toEqual([]);
    for (const absent of ["docs", "record", "share", "background", "layout"] as BarFeature[]) {
      expect(fit.inBar).not.toContain(absent);
      expect(fit.folded).not.toContain(absent);
    }
  });

  it("folds everything when there is room for nothing", () => {
    const fit = fitBar({ offered: ALL, capacity: 0 });
    expect(fit.inBar).toEqual([]);
    expect(fit.folded).toEqual(ALL);
  });

  it("loses no control on the way through, at any width", () => {
    // The property that matters most: folding moves a control, it never drops
    // one. A control in neither list is a feature that silently vanished.
    for (let capacity = 0; capacity <= ALL.length + 2; capacity++) {
      const fit = fitBar({ offered: ALL, capacity });
      expect([...fit.inBar, ...fit.folded].sort()).toEqual([...ALL].sort());
      expect(fit.inBar.filter((f) => fit.folded.includes(f))).toEqual([]);
    }
  });
});

describe("KEEP_PRIORITY", () => {
  it("ranks every control the bar can offer, exactly once", () => {
    // A control missing from the ranking would be folded first by accident
    // rather than by decision, and a duplicate would take two of the places.
    expect([...KEEP_PRIORITY].sort()).toEqual([...BAR_ORDER].sort());
    expect(new Set(KEEP_PRIORITY).size).toBe(KEEP_PRIORITY.length);
  });
});

describe("foldedBadgeTotal", () => {
  /**
   * Folding a control must not fold the news it was carrying, or the bar goes
   * quiet exactly when it is most crowded.
   */
  it("carries a folded control's number onto More", () => {
    expect(foldedBadgeTotal(["chat"], { chat: 3 })).toBe(3);
  });

  it("adds up several, because there is room for one number", () => {
    expect(foldedBadgeTotal(["chat", "people"], { chat: 3, people: 2 })).toBe(5);
  });

  it("ignores the numbers of controls that are still on the bar", () => {
    // Otherwise More would double-count what the member can already see.
    expect(foldedBadgeTotal(["layout"], { chat: 3, people: 2, layout: 0 })).toBeNull();
  });

  it("draws no badge rather than a badge reading zero", () => {
    expect(foldedBadgeTotal(["chat", "people"], { chat: 0, people: 0 })).toBeNull();
    expect(foldedBadgeTotal([], { chat: 9 })).toBeNull();
  });

  it("is not fooled by a nonsense count", () => {
    expect(foldedBadgeTotal(["chat"], { chat: Number.NaN })).toBeNull();
    expect(foldedBadgeTotal(["chat"], { chat: -4 })).toBeNull();
    expect(foldedBadgeTotal(["chat", "people"], { chat: Number.NaN, people: 2 })).toBe(2);
  });
});
