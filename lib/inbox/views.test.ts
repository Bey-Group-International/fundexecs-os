import { SAVED_VIEWS, viewParams, activeView } from "./views";

describe("SAVED_VIEWS", () => {
  it("offers the three quick views in order, each labelled", () => {
    expect(SAVED_VIEWS.map((v) => v.key)).toEqual(["all", "unread", "starred"]);
    for (const v of SAVED_VIEWS) expect(v.label).toBeTruthy();
  });
});

describe("viewParams", () => {
  it("maps each view to a mutually-exclusive read-state / star patch", () => {
    expect(viewParams("all")).toEqual({ unread: "", starred: "" });
    expect(viewParams("unread")).toEqual({ unread: "1", starred: "" });
    expect(viewParams("starred")).toEqual({ unread: "", starred: "1" });
  });

  it("clears the opposite flag so the chips behave as single-choice", () => {
    // Selecting Starred must clear Unread, and vice-versa.
    expect(viewParams("starred").unread).toBe("");
    expect(viewParams("unread").starred).toBe("");
  });
});

describe("activeView", () => {
  it("derives the active view from the current params", () => {
    expect(activeView({})).toBe("all");
    expect(activeView({ unread: "1" })).toBe("unread");
    expect(activeView({ starred: "1" })).toBe("starred");
  });

  it("prefers starred when both are set, matching the patch precedence", () => {
    expect(activeView({ unread: "1", starred: "1" })).toBe("starred");
  });

  it("round-trips: applying a view's params reads back as that view", () => {
    for (const key of ["all", "unread", "starred"] as const) {
      expect(activeView(viewParams(key))).toBe(key);
    }
  });
});
