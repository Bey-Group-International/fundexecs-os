/**
 * The four ways the chat panel could mislead the person using it.
 *
 * Each block names the defect it covers. All of them are decisions the panel
 * was making implicitly — by appending, by trusting, by ignoring a field it
 * was already carrying — which is why none of them could be seen by reading
 * the rendering code.
 */
import {
  CHAT_CLOCK_TOLERANCE_MS,
  CHAT_MAX_LENGTH,
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
