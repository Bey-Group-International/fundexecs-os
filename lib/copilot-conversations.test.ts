// lib/copilot-conversations.test.ts
// The rules that keep one conversation out of another: identity by place,
// storage that files and prunes, and a migration for the pre-v2 single thread.
import {
  CONVERSATIONS_VERSION,
  MAX_STORED_CONVERSATIONS,
  conversationKeyForPath,
  conversationLabelForPath,
  copilotSessionName,
  emptyStore,
  findConversation,
  migrateLegacyThread,
  otherConversations,
  parseStore,
  removeConversation,
  upsertConversation,
  type StoredConversation,
} from "@/lib/copilot-conversations";

type Turn = { id: string; text: string };

function conv(key: string, turns = 1, updatedAt = 1_000): StoredConversation<Turn> {
  return {
    key,
    label: key,
    sessionId: `sess-${key}`,
    thread: Array.from({ length: turns }, (_, i) => ({ id: `${key}-${i}`, text: "hi" })),
    updatedAt,
  };
}

describe("conversationKeyForPath", () => {
  it("gives a deal one conversation across all of its modules", () => {
    expect(conversationKeyForPath("/deal/abc-123")).toBe("deal:abc-123");
    expect(conversationKeyForPath("/deal/abc-123/documents")).toBe("deal:abc-123");
  });

  it("separates two different deals", () => {
    expect(conversationKeyForPath("/deal/abc")).not.toBe(conversationKeyForPath("/deal/xyz"));
  });

  it("separates a hub module from an unrelated area", () => {
    expect(conversationKeyForPath("/run/diligence")).toBe("scope:run/diligence");
    expect(conversationKeyForPath("/wallet")).toBe("scope:wallet");
    expect(conversationKeyForPath("/run/diligence")).not.toBe(conversationKeyForPath("/wallet"));
  });

  it("ignores a query string, so ?tab=x is the same conversation", () => {
    expect(conversationKeyForPath("/wallet?tab=treasury")).toBe(conversationKeyForPath("/wallet"));
  });
});

describe("conversationLabelForPath", () => {
  it("names the place, not the slug", () => {
    expect(conversationLabelForPath("/run/diligence")).toBe("Run · Diligence");
    expect(conversationLabelForPath("/wallet")).toBe("Wallet");
  });

  it("uses the deal's own name when it is known", () => {
    expect(conversationLabelForPath("/deal/abc")).toBe("Deal");
    expect(conversationLabelForPath("/deal/abc", "Meridian Growth")).toBe("Deal · Meridian Growth");
  });
});

describe("parseStore", () => {
  it("returns an empty store for missing or corrupt storage", () => {
    expect(parseStore(null).conversations).toEqual([]);
    expect(parseStore("not json").conversations).toEqual([]);
    expect(parseStore('{"conversations":"nope"}').conversations).toEqual([]);
  });

  it("drops entries that are not shaped like conversations", () => {
    const raw = JSON.stringify({
      version: 2,
      conversations: [conv("scope:wallet"), { key: "broken" }, null],
    });
    expect(parseStore<Turn>(raw).conversations.map((c) => c.key)).toEqual(["scope:wallet"]);
  });
});

describe("upsertConversation", () => {
  it("files a conversation under its key and keeps newest first", () => {
    let store = emptyStore<Turn>();
    store = upsertConversation(store, conv("scope:wallet", 1, 100));
    store = upsertConversation(store, conv("deal:abc", 1, 200));
    expect(store.conversations.map((c) => c.key)).toEqual(["deal:abc", "scope:wallet"]);
    expect(store.version).toBe(CONVERSATIONS_VERSION);
  });

  it("replaces rather than duplicates an existing conversation", () => {
    let store = upsertConversation(emptyStore<Turn>(), conv("scope:wallet", 1, 100));
    store = upsertConversation(store, conv("scope:wallet", 3, 300));
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].thread).toHaveLength(3);
  });

  it("does not store a conversation with no turns", () => {
    const store = upsertConversation(emptyStore<Turn>(), conv("scope:wallet", 0));
    expect(store.conversations).toEqual([]);
  });

  it("removes a conversation that has been emptied out", () => {
    let store = upsertConversation(emptyStore<Turn>(), conv("scope:wallet", 2));
    store = upsertConversation(store, conv("scope:wallet", 0));
    expect(findConversation(store, "scope:wallet")).toBeUndefined();
  });

  it("drops the oldest beyond the cap", () => {
    let store = emptyStore<Turn>();
    for (let i = 0; i < MAX_STORED_CONVERSATIONS + 5; i++) {
      store = upsertConversation(store, conv(`scope:s${i}`, 1, i));
    }
    expect(store.conversations).toHaveLength(MAX_STORED_CONVERSATIONS);
    // The most recently updated survive.
    expect(store.conversations[0].key).toBe(`scope:s${MAX_STORED_CONVERSATIONS + 4}`);
    expect(findConversation(store, "scope:s0")).toBeUndefined();
  });
});

describe("removeConversation", () => {
  it("drops only the named conversation", () => {
    let store = upsertConversation(emptyStore<Turn>(), conv("scope:wallet"));
    store = upsertConversation(store, conv("deal:abc"));
    const next = removeConversation(store, "scope:wallet");
    expect(next.conversations.map((c) => c.key)).toEqual(["deal:abc"]);
  });
});

describe("otherConversations", () => {
  it("lists every conversation but the current one, newest first", () => {
    let store = upsertConversation(emptyStore<Turn>(), conv("scope:wallet", 1, 100));
    store = upsertConversation(store, conv("deal:abc", 1, 300));
    store = upsertConversation(store, conv("scope:run/diligence", 1, 200));
    expect(otherConversations(store, "deal:abc").map((c) => c.key)).toEqual([
      "scope:run/diligence",
      "scope:wallet",
    ]);
  });
});

describe("migrateLegacyThread", () => {
  const legacy = JSON.stringify({ sessionId: "sess-old", thread: [{ id: "1", text: "hi" }] });

  it("adopts the old single thread into the place it is loaded from", () => {
    const store = migrateLegacyThread(emptyStore<Turn>(), legacy, {
      key: "scope:wallet",
      label: "Wallet",
      now: 5,
    });
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]).toMatchObject({ key: "scope:wallet", sessionId: "sess-old" });
  });

  it("never overwrites a conversation that already exists there", () => {
    const existing = upsertConversation(emptyStore<Turn>(), conv("scope:wallet", 4));
    const store = migrateLegacyThread(existing, legacy, { key: "scope:wallet", label: "Wallet", now: 5 });
    expect(findConversation(store, "scope:wallet")?.thread).toHaveLength(4);
  });

  it("ignores absent, corrupt, or empty legacy blobs", () => {
    const base = emptyStore<Turn>();
    const args = { key: "scope:wallet", label: "Wallet", now: 5 };
    expect(migrateLegacyThread(base, null, args).conversations).toEqual([]);
    expect(migrateLegacyThread(base, "not json", args).conversations).toEqual([]);
    expect(migrateLegacyThread(base, JSON.stringify({ thread: [] }), args).conversations).toEqual([]);
  });
});

describe("copilotSessionName", () => {
  it("names a session after the place and what was asked", () => {
    expect(copilotSessionName("/wallet", "What is our credit burn rate?")).toBe(
      "Wallet — What is our credit burn rate?",
    );
  });

  it("strips the routing annotation so it never becomes the visible title", () => {
    expect(copilotSessionName("/wallet", "[scope:wallet] Check the burn rate")).toBe(
      "Wallet — Check the burn rate",
    );
  });

  it("collapses whitespace and truncates to the column width", () => {
    const name = copilotSessionName("/wallet", "a".repeat(400));
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith("…")).toBe(true);
    expect(copilotSessionName("/wallet", "two\n\nlines")).toBe("Wallet — two lines");
  });

  it("falls back to the place when there is nothing to name it after", () => {
    expect(copilotSessionName("/wallet", "   ")).toBe("Wallet");
  });
});
