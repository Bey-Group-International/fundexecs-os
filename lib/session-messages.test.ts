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

// A minimal Supabase double. It records what each call chained and replays
// canned rows: `lookupRows` answers the select() that resolves a client-minted
// turn to a single row id, `writeRows` answers the update()/delete() itself.
function stubClient(
  writeRows: { id: string }[] | null,
  error: unknown = null,
  lookupRows: { id: string }[] = [],
) {
  const calls: {
    table: string;
    op: string;
    payload?: unknown;
    filters: [string, string][];
    lookupFilters: [string, string][];
    lookupLimit: number | null;
  } = { table: "", op: "", filters: [], lookupFilters: [], lookupLimit: null };

  function writeChain() {
    const chain = {
      eq(column: string, value: string) {
        calls.filters.push([column, value]);
        return chain;
      },
      select() {
        return Promise.resolve({ data: writeRows, error });
      },
    };
    return chain;
  }

  // The lookup chain resolves like a query (it is awaited directly), so it is
  // thenable as well as chainable.
  function lookupChain() {
    const chain = {
      eq(column: string, value: string) {
        calls.lookupFilters.push([column, value]);
        return chain;
      },
      order() {
        return chain;
      },
      limit(n: number) {
        calls.lookupLimit = n;
        return Promise.resolve({ data: lookupRows, error: null });
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      calls.table = table;
      return {
        select() {
          return lookupChain();
        },
        update(payload: unknown) {
          calls.op = "update";
          calls.payload = payload;
          return writeChain();
        },
        delete() {
          calls.op = "delete";
          return writeChain();
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

  it("resolves a turn minted in this session to a single row before writing", async () => {
    const { client, calls } = stubClient([{ id: "row-1" }], null, [{ id: "row-1" }]);
    await updateSessionMessage(client, {
      sessionId: "sess-1",
      turnId: "you-1750000000000",
      previousContent: "old",
      content: "new",
    });
    // The text match narrows to one row...
    expect(calls.lookupFilters).toEqual([
      ["session_id", "sess-1"],
      ["content", "old"],
    ]);
    expect(calls.lookupLimit).toBe(1);
    // ...and the write addresses that row by id, never by content. Without
    // this, asking the same question twice and editing one would rewrite both.
    expect(calls.filters).toEqual([
      ["session_id", "sess-1"],
      ["id", "row-1"],
    ]);
  });

  it("writes nothing when no row matches the turn", async () => {
    const { client, calls } = stubClient([{ id: "row-1" }], null, []);
    await expect(
      updateSessionMessage(client, {
        sessionId: "sess-1",
        turnId: "you-1",
        previousContent: "never persisted",
        content: "new",
      }),
    ).resolves.toBe(0);
    expect(calls.op).toBe("");
  });

  it("reports zero rows rather than throwing when the write fails", async () => {
    const { client } = stubClient(null, { message: "denied" }, [{ id: "row-1" }]);
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

  it("deletes exactly one row when several turns share the same text", async () => {
    // Two rows carry "gone"; the lookup returns only the newest.
    const { client, calls } = stubClient([{ id: "row-2" }], null, [{ id: "row-2" }]);
    const rows = await deleteSessionMessage(client, {
      sessionId: "sess-1",
      turnId: "earn-1750000000000",
      content: "gone",
    });
    expect(rows).toBe(1);
    expect(calls.lookupLimit).toBe(1);
    expect(calls.filters).toEqual([
      ["session_id", "sess-1"],
      ["id", "row-2"],
    ]);
  });

  it("deletes nothing when the turn was never persisted", async () => {
    const { client, calls } = stubClient([], null, []);
    await expect(
      deleteSessionMessage(client, { sessionId: "sess-1", turnId: "earn-1", content: "gone" }),
    ).resolves.toBe(0);
    expect(calls.op).toBe("");
  });
});
