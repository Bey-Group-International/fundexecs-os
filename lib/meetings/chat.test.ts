/**
 * The five ways the chat panel could mislead the person using it.
 *
 * Each block names the defect it covers. All of them are decisions the panel
 * was making implicitly — by appending, by trusting, by ignoring a field it
 * was already carrying, by keeping none of it — which is why none of them
 * could be seen by reading the rendering code.
 */
import {
  CHAT_CLOCK_TOLERANCE_MS,
  CHAT_MAX_LENGTH,
  GROUP_WINDOW_MS,
  chatClock,
  chatParts,
  groupChat,
  mergeChat,
  deliveryFromSendResult,
  displayNameFor,
  insertMessage,
  markDelivery,
  normalizeChatText,
  resolveTimestamp,
  type ChatMessage,
} from "@/lib/meetings/chat";

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1", from: "p1", displayName: "Alina", text: "hello", ts: 1_000, ...over,
});

// ── 1. A send that failed looked exactly like a send that worked ────────────

describe("deliveryFromSendResult", () => {
  it("calls a Realtime 'ok' delivered", () => {
    expect(deliveryFromSendResult("ok")).toBe("sent");
  });

  // The two failures the old code threw away.
  it("calls a timeout and an error undelivered", () => {
    expect(deliveryFromSendResult("timed out")).toBe("failed");
    expect(deliveryFromSendResult("error")).toBe("failed");
  });

  // "I cannot tell whether that was delivered" reads to the person as "it was
  // not", which is the safe direction: they can send it again.
  it("treats anything it cannot read as undelivered", () => {
    for (const v of [undefined, null, "", "OK", true, 1, {}]) {
      expect(deliveryFromSendResult(v)).toBe("failed");
    }
  });
});

describe("markDelivery", () => {
  it("records the outcome on the message it belongs to and no other", () => {
    const list = [msg({ id: "a", delivery: "sending" }), msg({ id: "b", ts: 2_000, delivery: "sending" })];
    const out = markDelivery(list, "b", "failed");
    expect(out.map((m) => m.delivery)).toEqual(["sending", "failed"]);
  });

  it("does not mutate the list it was handed", () => {
    const list = [msg({ delivery: "sending" })];
    markDelivery(list, "m1", "sent");
    expect(list[0].delivery).toBe("sending");
  });

  it("is a no-op for an id that is not there", () => {
    const list = [msg({ delivery: "sent" })];
    expect(markDelivery(list, "gone", "failed")).toEqual(list);
  });
});

// ── 2. Messages were ordered by arrival, so nobody saw the same room ────────

describe("insertMessage", () => {
  it("puts a message where it was spoken, not where it landed", () => {
    // Rae answered at 2000 and their packet arrived first; Alina spoke at 1500.
    let list: ChatMessage[] = [msg({ id: "a", ts: 1_000, text: "shall we" })];
    list = insertMessage(list, msg({ id: "c", ts: 2_000, text: "agreed" }));
    list = insertMessage(list, msg({ id: "b", ts: 1_500, text: "on the number" }));
    expect(list.map((m) => m.text)).toEqual(["shall we", "on the number", "agreed"]);
  });

  it("appends when the message is the newest, which is the usual case", () => {
    let list: ChatMessage[] = [msg({ id: "a", ts: 1_000 })];
    list = insertMessage(list, msg({ id: "b", ts: 2_000 }));
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  // Two people sending in the same millisecond still need ONE order, and it
  // has to be the same one on every screen — so it cannot depend on which
  // packet this particular browser saw first.
  it("orders a tie the same way whichever arrives first", () => {
    const x = msg({ id: "aaa", ts: 5_000 });
    const y = msg({ id: "bbb", ts: 5_000 });
    expect(insertMessage([x], y).map((m) => m.id)).toEqual(["aaa", "bbb"]);
    expect(insertMessage([y], x).map((m) => m.id)).toEqual(["aaa", "bbb"]);
  });

  it("ignores a message it already holds, so a retry cannot double it", () => {
    const list = [msg({ id: "a", ts: 1_000 })];
    expect(insertMessage(list, msg({ id: "a", ts: 1_000 }))).toHaveLength(1);
  });

  it("does not mutate the list it was handed", () => {
    const list = [msg({ id: "a", ts: 1_000 })];
    insertMessage(list, msg({ id: "b", ts: 2_000 }));
    expect(list).toHaveLength(1);
  });
});

describe("resolveTimestamp", () => {
  it("keeps ordinary skew, which is the thing that makes ordering work", () => {
    expect(resolveTimestamp(9_900, 10_000)).toBe(9_900);
  });

  // A machine an hour out would otherwise pin every message it ever sends to
  // the top or the bottom of the panel.
  it("substitutes our own clock when theirs is not credible", () => {
    const now = 1_000_000;
    expect(resolveTimestamp(now - CHAT_CLOCK_TOLERANCE_MS - 1, now)).toBe(now);
    expect(resolveTimestamp(now + CHAT_CLOCK_TOLERANCE_MS + 1, now)).toBe(now);
  });

  it("treats a missing or unusable timestamp as arrival time", () => {
    expect(resolveTimestamp(undefined, 4_000)).toBe(4_000);
    expect(resolveTimestamp("1000", 4_000)).toBe(4_000);
    expect(resolveTimestamp(NaN, 4_000)).toBe(4_000);
  });
});

// ── 3. A name was whatever the message claimed ──────────────────────────────

describe("displayNameFor", () => {
  const roster = new Map([["p1", { displayName: "Alina Roy" }]]);

  it("takes the name from the roster, not from the payload", () => {
    expect(displayNameFor({ from: "p1", displayName: "Rae Okafor" }, roster)).toBe("Alina Roy");
  });

  it("falls back to the claimed name for somebody not in the roster", () => {
    expect(displayNameFor({ from: "p9", displayName: "Rae Okafor" }, roster)).toBe("Rae Okafor");
  });

  it("never renders a nameless message", () => {
    expect(displayNameFor({ from: "p9", displayName: "   " }, roster)).toBe("Someone");
    expect(displayNameFor({ from: "p9" }, roster)).toBe("Someone");
    expect(displayNameFor({ from: "p9", displayName: "x" }, new Map([["p9", { displayName: "  " }]]))).toBe("x");
  });
});

// ── 4. Text arrived unbounded and was rendered unbounded ────────────────────

describe("normalizeChatText", () => {
  it("trims", () => {
    expect(normalizeChatText("  ship it  ")).toBe("ship it");
  });

  it("bounds a pasted document", () => {
    expect(normalizeChatText("x".repeat(CHAT_MAX_LENGTH + 500))).toHaveLength(CHAT_MAX_LENGTH);
  });

  // Cutting mid-pair would end the message with a replacement character — the
  // emoji would not just be missing, it would be visibly broken.
  it("does not cut a surrogate pair in half", () => {
    const out = normalizeChatText("a".repeat(CHAT_MAX_LENGTH - 1) + "😀");
    expect(out).toHaveLength(CHAT_MAX_LENGTH - 1);
    expect(out.endsWith("\uD83D")).toBe(false);
  });

  it("keeps an emoji that fits", () => {
    expect(normalizeChatText("ship it 🚀")).toBe("ship it 🚀");
  });

  it("returns nothing for whitespace or a non-string", () => {
    expect(normalizeChatText("   ")).toBe("");
    expect(normalizeChatText(undefined)).toBe("");
    expect(normalizeChatText(42)).toBe("");
  });
});

// ── 5. Nothing stored it ────────────────────────────────────────────────────
//
// What storing the chat made newly true: a message is going into a table and
// into an exported document, history and the live panel have to fold together
// without duplicating, and the result has to read as a conversation.

describe("normalizeChatText, once a message is going into a table", () => {
  it("keeps the line breaks somebody meant", () => {
    expect(normalizeChatText("line one\nline two")).toBe("line one\nline two");
  });

  it("settles on one newline convention", () => {
    expect(normalizeChatText("line one\r\nline two")).toBe("line one\nline two");
  });

  it("collapses a paste that would push the room off the top of the panel", () => {
    expect(normalizeChatText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  // Invisible in the composer, and about to be stored, shown to everyone, and
  // put in an exported document.
  it("strips control characters a paste can carry", () => {
    expect(normalizeChatText("he\u0000llo\u0007")).toBe("hello");
  });
});

describe("mergeChat", () => {
  it("orders one conversation by time", () => {
    const merged = mergeChat(
      [msg({ id: "b", from: "u2", text: "second", ts: 2_000 })],
      [msg({ id: "a", from: "u1", text: "first", ts: 1_000 })],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  // A message you sent comes back from the server as well as being shown
  // locally the moment you sent it.
  it("shows a message once when it arrives twice", () => {
    const merged = mergeChat([msg({ id: "a", ts: 1_000 })], [msg({ id: "a", ts: 1_000 })]);
    expect(merged).toHaveLength(1);
  });

  it("lets the stored copy win, since it arrives second", () => {
    const merged = mergeChat(
      [msg({ id: "a", from: "u1", text: "hi", ts: 1_000, displayName: "guest" })],
      [msg({ id: "a", from: "u1", text: "hi", ts: 1_000, displayName: "Ana Vidal" })],
    );
    expect(merged[0].displayName).toBe("Ana Vidal");
  });

  it("orders ties without flickering between renders", () => {
    const merged = mergeChat([msg({ id: "b", ts: 5 }), msg({ id: "a", ts: 5 })]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  // Local knowledge about your own send that no stored row carries. Losing it
  // would silently retract a "Not delivered" the sender is looking at.
  it("keeps what the socket said about your own message", () => {
    const merged = mergeChat(
      [msg({ id: "a", ts: 1_000, delivery: "failed" })],
      [msg({ id: "a", ts: 1_000, displayName: "Ana Vidal" })],
    );
    expect(merged[0]).toMatchObject({ displayName: "Ana Vidal", delivery: "failed" });
  });

  it("orders the same way insertMessage does", () => {
    const a = msg({ id: "a", ts: 5 });
    const b = msg({ id: "b", ts: 5 });
    expect(mergeChat([b, a]).map((m) => m.id)).toEqual(insertMessage([b], a).map((m) => m.id));
  });

  it("drops entries that are not messages", () => {
    expect(mergeChat([{ id: "", from: "u", displayName: "u", text: "x", ts: 1 }])).toEqual([]);
    expect(mergeChat([])).toEqual([]);
  });
});

describe("groupChat", () => {
  it("reads three lines in a row as one person talking", () => {
    const turns = groupChat([
      msg({ id: "a", from: "u1", text: "one", ts: 0, displayName: "u1" }),
      msg({ id: "b", from: "u1", text: "two", ts: 1_000, displayName: "u1" }),
      msg({ id: "c", from: "u2", text: "hi", ts: 2_000, displayName: "u2" }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].messages.map((m) => m.text)).toEqual(["one", "two"]);
    expect(turns[1].from).toBe("u2");
  });

  it("starts a new turn when the same person returns much later", () => {
    const turns = groupChat([msg({ id: "a", from: "u1", text: "one", ts: 0, displayName: "u1" }), msg({ id: "b", from: "u1", text: "two", ts: GROUP_WINDOW_MS + 1, displayName: "u1" })]);
    expect(turns).toHaveLength(2);
  });

  // The turn keeps the first message's id so React keys hold as it grows.
  it("keys a turn on the message that started it", () => {
    const turns = groupChat([msg({ id: "a", from: "u1", text: "one", ts: 0, displayName: "u1" }), msg({ id: "b", from: "u1", text: "two", ts: 1_000, displayName: "u1" })]);
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
