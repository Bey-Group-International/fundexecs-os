import {
  GROUP_WINDOW_MS,
  MAX_CHAT_CHARS,
  chatClock,
  chatParts,
  cleanChatText,
  groupChat,
  mergeChat,
  type ChatMessage,
} from "@/lib/meetings/chat";

const msg = (id: string, from: string, text: string, ts: number, displayName = from): ChatMessage => ({
  id,
  from,
  displayName,
  text,
  ts,
});

describe("cleanChatText", () => {
  it("trims, and treats nothing as nothing", () => {
    expect(cleanChatText("  hello  ")).toBe("hello");
    expect(cleanChatText("   ")).toBe("");
    expect(cleanChatText(null)).toBe("");
  });

  it("keeps the line breaks somebody meant", () => {
    expect(cleanChatText("line one\nline two")).toBe("line one\nline two");
  });

  it("collapses a paste that would push the room off the top of the panel", () => {
    expect(cleanChatText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  // Invisible in the composer, and about to be stored, shown to everyone, and
  // put in an exported document.
  it("strips control characters a paste can carry", () => {
    expect(cleanChatText("he\u0000llo\u0007")).toBe("hello");
  });

  it("caps a message that is no longer a message", () => {
    expect(cleanChatText("x".repeat(MAX_CHAT_CHARS + 500))).toHaveLength(MAX_CHAT_CHARS);
  });
});

describe("mergeChat", () => {
  it("orders one conversation by time", () => {
    const merged = mergeChat([msg("b", "u2", "second", 2_000)], [msg("a", "u1", "first", 1_000)]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  // A message you sent comes back from the server as well as being shown
  // locally the moment you sent it.
  it("shows a message once when it arrives twice", () => {
    const merged = mergeChat([msg("a", "u1", "hi", 1_000)], [msg("a", "u1", "hi", 1_000)]);
    expect(merged).toHaveLength(1);
  });

  it("lets the stored copy win, since it arrives second", () => {
    const merged = mergeChat(
      [msg("a", "u1", "hi", 1_000, "guest")],
      [msg("a", "u1", "hi", 1_000, "Ana Vidal")],
    );
    expect(merged[0].displayName).toBe("Ana Vidal");
  });

  it("orders ties without flickering between renders", () => {
    const merged = mergeChat([msg("b", "u2", "b", 5), msg("a", "u1", "a", 5)]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("drops entries that are not messages", () => {
    expect(mergeChat([{ id: "", from: "u", displayName: "u", text: "x", ts: 1 }])).toEqual([]);
    expect(mergeChat([])).toEqual([]);
  });
});

describe("groupChat", () => {
  it("reads three lines in a row as one person talking", () => {
    const turns = groupChat([
      msg("a", "u1", "one", 0),
      msg("b", "u1", "two", 1_000),
      msg("c", "u2", "hi", 2_000),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].messages.map((m) => m.text)).toEqual(["one", "two"]);
    expect(turns[1].from).toBe("u2");
  });

  it("starts a new turn when the same person returns much later", () => {
    const turns = groupChat([msg("a", "u1", "one", 0), msg("b", "u1", "two", GROUP_WINDOW_MS + 1)]);
    expect(turns).toHaveLength(2);
  });

  // The turn keeps the first message's id so React keys hold as it grows.
  it("keys a turn on the message that started it", () => {
    const turns = groupChat([msg("a", "u1", "one", 0), msg("b", "u1", "two", 1_000)]);
    expect(turns[0].id).toBe("a");
    expect(turns[0].ts).toBe(0);
  });

  it("survives an empty conversation", () => {
    expect(groupChat([])).toEqual([]);
  });
});

describe("chatParts", () => {
  it("leaves plain text alone", () => {
    expect(chatParts("no links here")).toEqual([{ kind: "text", value: "no links here" }]);
  });

  // The commonest thing anyone puts in a meeting chat, and it could not be
  // followed.
  it("finds a link in a sentence", () => {
    expect(chatParts("deck is at https://fund.test/deck now")).toEqual([
      { kind: "text", value: "deck is at " },
      { kind: "link", value: "https://fund.test/deck", href: "https://fund.test/deck" },
      { kind: "text", value: " now" },
    ]);
  });

  it("leaves the sentence's full stop out of the link", () => {
    const parts = chatParts("see https://fund.test/docs.");
    expect(parts[1]).toEqual({ kind: "link", value: "https://fund.test/docs", href: "https://fund.test/docs" });
    expect(parts[2]).toEqual({ kind: "text", value: "." });
  });

  it("finds several links", () => {
    const parts = chatParts("https://a.test and https://b.test");
    expect(parts.filter((p) => p.kind === "link")).toHaveLength(2);
  });

  // This decides what becomes a clickable href in front of everyone in the
  // room, so it matches plainly-written http(s) and nothing else.
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "fund.test/deck",
    "ftp://fund.test/x",
  ])("does not make %j a link", (text) => {
    expect(chatParts(text).every((p) => p.kind === "text")).toBe(true);
  });

  it("does not swallow a scheme hidden inside a sentence", () => {
    // "javascript:" must not become a link even when an http link is present.
    const parts = chatParts("try javascript:alert(1) or https://fund.test");
    const links = parts.filter((p) => p.kind === "link");
    expect(links).toHaveLength(1);
    expect(links[0].kind === "link" && links[0].href).toBe("https://fund.test");
  });

  it("returns nothing for nothing", () => {
    expect(chatParts("")).toEqual([]);
  });
});

describe("chatClock", () => {
  it("reads as a time", () => {
    expect(chatClock(Date.parse("2026-09-18T14:05:00Z"), "en-GB")).toMatch(/\d{1,2}:\d{2}/);
  });

  it("says nothing for a time that is not one", () => {
    expect(chatClock(NaN)).toBe("");
  });
});
