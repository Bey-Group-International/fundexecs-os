import { actionForKey, isTypingTarget, SHORTCUT_HELP } from "./calendar-shortcuts";

describe("isTypingTarget", () => {
  it("recognises the form fields someone types into", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("recognises a contenteditable, which is not a form field", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for the grid itself", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("does not care about tag-name casing", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });
});

describe("actionForKey", () => {
  it("maps the view letters", () => {
    expect(actionForKey({ key: "d" })).toEqual({ kind: "view", view: "day" });
    expect(actionForKey({ key: "w" })).toEqual({ kind: "view", view: "week" });
    expect(actionForKey({ key: "m" })).toEqual({ kind: "view", view: "month" });
    expect(actionForKey({ key: "a" })).toEqual({ kind: "view", view: "agenda" });
  });

  it("maps the view numbers, for the same views", () => {
    expect(actionForKey({ key: "1" })).toEqual({ kind: "view", view: "day" });
    expect(actionForKey({ key: "2" })).toEqual({ kind: "view", view: "week" });
    expect(actionForKey({ key: "3" })).toEqual({ kind: "view", view: "month" });
    expect(actionForKey({ key: "4" })).toEqual({ kind: "view", view: "agenda" });
  });

  it("accepts capitals, which caps lock produces", () => {
    expect(actionForKey({ key: "D" })).toEqual({ kind: "view", view: "day" });
    expect(actionForKey({ key: "T" })).toEqual({ kind: "today" });
  });

  it("maps today", () => {
    expect(actionForKey({ key: "t" })).toEqual({ kind: "today" });
  });

  it("maps forward navigation from letters and arrows alike", () => {
    for (const key of ["j", "n", "ArrowRight", "ArrowDown"]) {
      expect(actionForKey({ key })).toEqual({ kind: "next" });
    }
  });

  it("maps backward navigation from letters and arrows alike", () => {
    for (const key of ["k", "p", "ArrowLeft", "ArrowUp"]) {
      expect(actionForKey({ key })).toEqual({ kind: "prev" });
    }
  });

  it("maps the help key, which needs shift on most layouts", () => {
    expect(actionForKey({ key: "?", shiftKey: true })).toEqual({ kind: "help" });
  });

  it("ignores anything unbound", () => {
    expect(actionForKey({ key: "q" })).toBeNull();
    expect(actionForKey({ key: "Enter" })).toBeNull();
    expect(actionForKey({ key: " " })).toBeNull();
    expect(actionForKey({ key: "5" })).toBeNull();
  });

  it("leaves browser and OS chords alone", () => {
    // ⌘D bookmarks, Ctrl+A selects all, Alt+← goes back. Stealing any of those
    // is worse than having no shortcut at all.
    expect(actionForKey({ key: "d", metaKey: true })).toBeNull();
    expect(actionForKey({ key: "a", ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: "ArrowLeft", altKey: true })).toBeNull();
  });

  it("ignores shifted letters, which are not the bindings", () => {
    expect(actionForKey({ key: "d", shiftKey: true })).toBeNull();
  });

  it("stays out of the way while someone is typing", () => {
    expect(actionForKey({ key: "d" }, { tagName: "INPUT" })).toBeNull();
    expect(actionForKey({ key: "t" }, { tagName: "TEXTAREA" })).toBeNull();
    expect(actionForKey({ key: "?", shiftKey: true }, { tagName: "INPUT" })).toBeNull();
    expect(actionForKey({ key: "m" }, { tagName: "DIV", isContentEditable: true })).toBeNull();
  });

  it("still works when the keystroke lands on the grid", () => {
    expect(actionForKey({ key: "w" }, { tagName: "DIV" })).toEqual({ kind: "view", view: "week" });
  });
});

describe("SHORTCUT_HELP", () => {
  it("documents every binding the mapper accepts", () => {
    const documented = SHORTCUT_HELP.map((h) => h.keys).join(" ").toLowerCase();
    for (const key of ["d", "w", "m", "a", "t", "j", "k", "?"]) {
      expect(documented).toContain(key);
    }
  });

  it("gives every row a description", () => {
    for (const row of SHORTCUT_HELP) {
      expect(row.keys.trim().length).toBeGreaterThan(0);
      expect(row.description.trim().length).toBeGreaterThan(0);
    }
  });
});
