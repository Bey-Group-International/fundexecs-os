// Tests for the pure pane-tree layout model.
import {
  emptyLayout,
  makeLeaf,
  openPane,
  splitPane,
  closePane,
  updateLeaf,
  resizeSplit,
  focusPane,
  leaves,
  findLeaf,
  paneCount,
  defaultLayoutForPreset,
  serializeLayout,
  deserializeLayout,
  LAYOUT_VERSION,
  type SplitPane,
} from "./layout";

describe("layout — construction + open", () => {
  it("opens the first pane as the root and focuses it", () => {
    const l = openPane(emptyLayout(), makeLeaf("a", "deal", { entityLabel: "Maple Street" }));
    expect(l.root?.kind).toBe("leaf");
    expect(paneCount(l)).toBe(1);
    expect(l.focusedPaneId).toBe("a");
    expect(findLeaf(l, "a")?.title).toBe("Deal: Maple Street");
  });

  it("opening into a focused pane replaces it in place (open here)", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = openPane(l, makeLeaf("b", "fund"));
    expect(paneCount(l)).toBe(1); // replaced, not added
    expect(findLeaf(l, "a")).toBeNull();
    expect(l.focusedPaneId).toBe("b");
  });

  it("opening with no focus splits the root so nothing is lost", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = { ...l, focusedPaneId: null };
    l = openPane(l, makeLeaf("b", "fund"), "s1");
    expect(paneCount(l)).toBe(2);
    expect(l.root?.kind).toBe("split");
  });
});

describe("layout — split + close", () => {
  it("splits a leaf into two and focuses the new pane", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = splitPane(l, "a", "row", makeLeaf("b", "analysis"), "s1");
    expect(paneCount(l)).toBe(2);
    expect(l.root?.kind).toBe("split");
    expect((l.root as SplitPane).direction).toBe("row");
    expect(l.focusedPaneId).toBe("b");
  });

  it("closing a pane collapses a single-child split back to the leaf", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = splitPane(l, "a", "row", makeLeaf("b", "analysis"), "s1");
    l = closePane(l, "b");
    expect(paneCount(l)).toBe(1);
    expect(l.root?.kind).toBe("leaf");
    expect(findLeaf(l, "a")).not.toBeNull();
  });

  it("closing the last pane yields an empty layout", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = closePane(l, "a");
    expect(l.root).toBeNull();
    expect(l.focusedPaneId).toBeNull();
    expect(paneCount(l)).toBe(0);
  });

  it("closing the focused pane moves focus to a remaining leaf", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = splitPane(l, "a", "row", makeLeaf("b", "analysis"), "s1"); // focus = b
    l = closePane(l, "b");
    expect(l.focusedPaneId).toBe("a");
  });
});

describe("layout — update + resize", () => {
  it("binds an entity to a pane in place", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = updateLeaf(l, "a", { entityId: "deal-1", entityLabel: "Maple Street", title: "Deal: Maple Street" });
    const leaf = findLeaf(l, "a")!;
    expect(leaf.entityId).toBe("deal-1");
    expect(leaf.entityLabel).toBe("Maple Street");
  });

  it("resize clamps to a floor and renormalizes so no pane hits zero", () => {
    let l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    l = splitPane(l, "a", "row", makeLeaf("b", "analysis"), "s1");
    l = resizeSplit(l, "s1", [0.99, 0.01]);
    const split = l.root as SplitPane;
    expect(split.sizes[1]).toBeGreaterThanOrEqual(0.08);
    expect(split.sizes[0] + split.sizes[1]).toBeCloseTo(1, 5);
  });

  it("focusPane ignores an unknown id", () => {
    const l = openPane(emptyLayout(), makeLeaf("a", "deal"));
    expect(focusPane(l, "nope").focusedPaneId).toBe("a");
  });
});

describe("layout — presets", () => {
  it("every preset yields a non-empty, well-formed layout with a focus", () => {
    for (const preset of [
      "deal_underwriting",
      "fundraising",
      "investor_relations",
      "portfolio_monitoring",
      "market_intelligence",
      "executive_brief",
      "custom",
    ] as const) {
      const l = defaultLayoutForPreset(preset);
      expect(l.root).not.toBeNull();
      expect(paneCount(l)).toBeGreaterThan(0);
      expect(l.focusedPaneId).not.toBeNull();
      expect(findLeaf(l, l.focusedPaneId!)).not.toBeNull();
    }
  });

  it("is deterministic — same preset + id builds the same tree", () => {
    expect(defaultLayoutForPreset("deal_underwriting", "x")).toEqual(
      defaultLayoutForPreset("deal_underwriting", "x"),
    );
  });
});

describe("layout — serialization round-trip + tolerance", () => {
  it("round-trips a non-trivial layout", () => {
    let l = defaultLayoutForPreset("deal_underwriting");
    l = updateLeaf(l, leaves(l)[1].id, { entityId: "deal-1", entityLabel: "Maple" });
    const restored = deserializeLayout(serializeLayout(l));
    expect(restored).toEqual(l);
  });

  it("discards a layout with an unrecognized version", () => {
    const restored = deserializeLayout({ version: LAYOUT_VERSION + 1, root: { kind: "leaf", id: "a", paneType: "deal", title: "x" } });
    expect(restored.root).toBeNull();
  });

  it("tolerates garbage / null / wrong shapes", () => {
    expect(deserializeLayout(null).root).toBeNull();
    expect(deserializeLayout("nope").root).toBeNull();
    expect(deserializeLayout({}).root).toBeNull();
    expect(deserializeLayout({ version: LAYOUT_VERSION, root: 42 }).root).toBeNull();
  });

  it("coerces an unknown pane type to blank and repairs a dangling focus", () => {
    const restored = deserializeLayout({
      version: LAYOUT_VERSION,
      root: { kind: "leaf", id: "a", paneType: "wormhole", title: "x" },
      focusedPaneId: "ghost",
    });
    expect(findLeaf(restored, "a")?.paneType).toBe("blank");
    expect(restored.focusedPaneId).toBe("a"); // dangling "ghost" repaired
  });

  it("collapses a persisted single-child split", () => {
    const restored = deserializeLayout({
      version: LAYOUT_VERSION,
      root: { kind: "split", id: "s", direction: "row", children: [{ kind: "leaf", id: "a", paneType: "deal", title: "x" }], sizes: [1] },
    });
    expect(restored.root?.kind).toBe("leaf");
  });
});
