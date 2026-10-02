import {
  TILES_PER_PAGE,
  clampPage,
  controlsMayHide,
  gridColumns,
  pageCount,
  pageTiles,
  visibleNotices,
} from "./room-layout";

describe("gridColumns", () => {
  it("grows with the call on a wide screen, and stops at four", () => {
    expect([1, 2, 4, 5, 9, 10, 16, 40].map((n) => gridColumns(n, "desktop"))).toEqual([1, 2, 2, 3, 3, 4, 4, 4]);
  });

  it("is never more than two across a phone", () => {
    expect([1, 2, 3, 6].map((n) => gridColumns(n, "mobile"))).toEqual([1, 2, 2, 2]);
  });

  it("treats an empty or odd count as one tile", () => {
    expect(gridColumns(0, "desktop")).toBe(1);
    expect(gridColumns(-3, "mobile")).toBe(1);
  });
});

describe("paging", () => {
  it("counts pages and pulls a stale page back inside them", () => {
    expect(pageCount(0, "desktop")).toBe(1);
    expect(pageCount(16, "desktop")).toBe(1);
    expect(pageCount(17, "desktop")).toBe(2);
    expect(clampPage(5, 17, "desktop")).toBe(1);
    expect(clampPage(-1, 17, "desktop")).toBe(0);
  });

  it("keeps you on every page, first", () => {
    const others = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const first = pageTiles("me", others, 0, "desktop");
    const second = pageTiles("me", others, 1, "desktop");
    expect(first.pages).toBe(2);
    expect(first.tiles).toHaveLength(TILES_PER_PAGE.desktop);
    expect(first.tiles[0]).toBe("me");
    expect(second.tiles[0]).toBe("me");
    // Everybody else appears exactly once across the pages.
    expect([...first.tiles.slice(1), ...second.tiles.slice(1)]).toEqual(others);
  });

  it("lands on the last page when the call shrinks under it", () => {
    const others = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const page = pageTiles("me", others, 3, "mobile");
    expect(page.page).toBe(1);
    expect(page.tiles).toEqual(["me", "p5", "p6"]);
  });

  it("does not page a call that fits", () => {
    const page = pageTiles("me", ["a", "b"], 0, "desktop");
    expect(page).toEqual({ tiles: ["me", "a", "b"], page: 0, pages: 1 });
  });
});

describe("visibleNotices", () => {
  const notices = [
    { id: "guest", priority: 10 },
    { id: "recording", pinned: true, priority: 95 },
    { id: "echo", priority: 60 },
    { id: "removal", priority: 80 },
  ];

  it("shows the pinned notices and the most urgent of the rest", () => {
    const { shown, hidden } = visibleNotices(notices, false);
    expect(shown.map((n) => n.id)).toEqual(["recording", "removal"]);
    expect(hidden).toBe(2);
  });

  it("shows everything, most urgent first, when expanded", () => {
    const { shown, hidden } = visibleNotices(notices, true);
    expect(shown.map((n) => n.id)).toEqual(["recording", "removal", "echo", "guest"]);
    expect(hidden).toBe(0);
  });

  it("never folds a pinned notice, however many there are", () => {
    const { shown } = visibleNotices([{ id: "a", pinned: true, priority: 1 }, { id: "b", pinned: true, priority: 1 }], false);
    expect(shown.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("has nothing to fold when one notice is up", () => {
    expect(visibleNotices([{ id: "echo", priority: 60 }], false)).toEqual({ shown: [{ id: "echo", priority: 60 }], hidden: 0 });
  });
});

describe("controlsMayHide", () => {
  const idle = { finePointer: true, live: true, waitingCount: 0, menuOpen: false, focusInside: false };

  it("lets the bar go on a mouse-driven screen with nothing in use", () => {
    expect(controlsMayHide(idle)).toBe(true);
  });

  it.each([
    ["on a touch screen", { finePointer: false }],
    ["outside the live call", { live: false }],
    ["while someone waits at the door", { waitingCount: 1 }],
    ["while a menu is open", { menuOpen: true }],
    ["while keyboard focus is in the bar", { focusInside: true }],
  ])("keeps it %s", (_, over) => {
    expect(controlsMayHide({ ...idle, ...over })).toBe(false);
  });
});
