import {
  sanitizeChatText,
  isMessageVisible,
  type ChatMessage,
} from "./chat";
import { PROXIMITY_RADIUS } from "./layout";

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    authorId: "u1",
    authorName: "Ada",
    color: "#fff",
    text: "hi",
    scope: "office",
    x: 0,
    y: 0,
    ts: 0,
    ...overrides,
  };
}

describe("sanitizeChatText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(sanitizeChatText("   hello   ")).toBe("hello");
  });

  it("collapses internal whitespace runs to single spaces", () => {
    expect(sanitizeChatText("a\t\t  b\n\nc")).toBe("a b c");
  });

  it("strips control characters", () => {
    // NUL, BEL, and a C1 control byte embedded between letters.
    const raw = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c${String.fromCharCode(0x9f)}d`;
    expect(sanitizeChatText(raw)).toBe("abcd");
  });

  it("caps length at the default maximum", () => {
    expect(sanitizeChatText("x".repeat(600))).toHaveLength(500);
  });

  it("respects a custom maximum", () => {
    expect(sanitizeChatText("hello world", 5)).toBe("hello");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(sanitizeChatText("   \n\t  ")).toBe("");
  });
});

describe("isMessageVisible", () => {
  it("shows office-scoped messages regardless of distance", () => {
    const m = msg({ scope: "office", x: 100, y: 100 });
    expect(isMessageVisible(m, { x: 0, y: 0 })).toBe(true);
  });

  it("shows proximity-scoped messages within range", () => {
    const m = msg({ scope: "proximity", x: 0, y: 0 });
    expect(isMessageVisible(m, { x: 3, y: 0 }, 4)).toBe(true);
  });

  it("hides proximity-scoped messages out of range", () => {
    const m = msg({ scope: "proximity", x: 0, y: 0 });
    expect(isMessageVisible(m, { x: 10, y: 0 }, 4)).toBe(false);
  });

  it("treats a viewer exactly on the radius as visible", () => {
    const m = msg({ scope: "proximity", x: 0, y: 0 });
    expect(isMessageVisible(m, { x: 4, y: 0 }, 4)).toBe(true);
  });

  it("defaults to the office proximity radius", () => {
    const m = msg({ scope: "proximity", x: 0, y: 0 });
    expect(isMessageVisible(m, { x: PROXIMITY_RADIUS, y: 0 })).toBe(true);
    expect(isMessageVisible(m, { x: PROXIMITY_RADIUS + 0.01, y: 0 })).toBe(false);
  });
});
