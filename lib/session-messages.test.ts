import {
  deleteSessionMessage,
  isPersistedTurnId,
  toChatTurns,
  updateSessionMessage,
} from "@/lib/session-messages";

describe("toChatTurns", () => {
  it("maps assistant rows to Earn turns and user rows to You turns, with timestamps", () => {
    const turns = toChatTurns([
      { id: "1", role: "user", content: "What's a good DSCR?", created_at: "2026-06-22T13:00:00Z" },
      { id: "2", role: "assistant", content: "For stabilized multifamily, 1.25x+.", created_at: "2026-06-22T13:00:05Z" },
    ]);
    expect(turns).toEqual([
      { id: "1", role: "you", content: "What's a good DSCR?", ts: Date.parse("2026-06-22T13:00:00Z") },
      { id: "2", role: "earn", content: "For stabilized multifamily, 1.25x+.", ts: Date.parse("2026-06-22T13:00:05Z") },
    ]);
  });

  it("returns an empty list for no rows", () => {
    expect(toChatTurns([])).toEqual([]);
  });
});

describe("isPersistedTurnId", () => {
  it("recognises a database uuid", () => {
    expect(isPersistedTurnId("8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90")).toBe(true);
  });

  it("rejects the ids the composer mints for turns it has just created", () => {
    expect(isPersistedTurnId("you-1750000000000")).toBe(false);
    expect(isPersistedTurnId("earn-1750000000000")).toBe(false);
    expect(isPersistedTurnId("loaded-3")).toBe(false);
  });
});

// A minimal Supabase double: records the filters a call chained, and resolves
// with whatever rows the test hands it.
function stubClient(rows: { id: string }[] | null, error: unknown = null) {
  const calls: { table: string; op: string; payload?: unknown; filters: [string, string][] } = {
    table: "",
    op: "",
    filters: [],
  };
  const chain = {
    eq(column: string, value: string) {
      calls.filters.push([column, value]);
      return chain;
    },
    select() {
      return Promise.resolve({ data: rows, error });
    },
  };
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        update(payload: unknown) {
          calls.op = "update";
          calls.payload = payload;
          return chain;
        },
        delete() {
          calls.op = "delete";
          return chain;
        },
      };
    },
  };
  // The helpers only touch the surface stubbed above.
  return { client: client as never, calls };
}

describe("updateSessionMessage", () => {
  it("addresses the row by id when the turn came from the database", async () => {
    const { client, calls } = stubClient([{ id: "8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90" }]);
    const rows = await updateSessionMessage(client, {
      sessionId: "sess-1",
      turnId: "8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90",
      previousContent: "old",
      content: "new",
    });
    expect(rows).toBe(1);
    expect(calls.table).toBe("session_messages");
    expect(calls.payload).toEqual({ content: "new" });
    expect(calls.filters).toEqual([
      ["session_id", "sess-1"],
      ["id", "8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90"],
    ]);
  });

  it("falls back to matching the previous text for a turn minted in this session", async () => {
    const { client, calls } = stubClient([{ id: "row-1" }]);
    await updateSessionMessage(client, {
      sessionId: "sess-1",
      turnId: "you-1750000000000",
      previousContent: "old",
      content: "new",
    });
    expect(calls.filters).toEqual([
      ["session_id", "sess-1"],
      ["content", "old"],
    ]);
  });

  it("reports zero rows rather than throwing when the write fails", async () => {
    const { client } = stubClient(null, { message: "denied" });
    await expect(
      updateSessionMessage(client, {
        sessionId: "sess-1",
        turnId: "you-1",
        previousContent: "old",
        content: "new",
      }),
    ).resolves.toBe(0);
  });
});

describe("deleteSessionMessage", () => {
  it("deletes the row by id when the turn came from the database", async () => {
    const { client, calls } = stubClient([{ id: "8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90" }]);
    const rows = await deleteSessionMessage(client, {
      sessionId: "sess-1",
      turnId: "8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90",
      content: "gone",
    });
    expect(rows).toBe(1);
    expect(calls.op).toBe("delete");
    expect(calls.filters).toEqual([
      ["session_id", "sess-1"],
      ["id", "8f14e45f-ceea-467a-9a4b-2c8e7f2a1b90"],
    ]);
  });

  it("matches on content for a turn that has no row id yet", async () => {
    const { client, calls } = stubClient([]);
    const rows = await deleteSessionMessage(client, {
      sessionId: "sess-1",
      turnId: "earn-1750000000000",
      content: "gone",
    });
    expect(rows).toBe(0);
    expect(calls.filters).toEqual([
      ["session_id", "sess-1"],
      ["content", "gone"],
    ]);
  });
});
