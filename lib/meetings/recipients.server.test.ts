// Resolving attendance rows to people you can write to.
//
// The rules live in recipients.ts and are tested there. This is about the two
// queries: that the directory is asked once for the members who were present,
// that a guest comes back as somebody with no address rather than not at all,
// and that neither failure takes the email down with it.

import { loadPresentPeople, PRESENT_LIMIT } from "@/lib/meetings/recipients.server";

type Result = { data: unknown; error: { message: string } | null };

/**
 * A supabase client just real enough for this function.
 *
 * Every builder method returns the builder, and the builder is awaitable — this
 * function awaits the query directly rather than through `maybeSingle`, so a
 * fake whose builders are plain objects would resolve to the builder and read
 * `data` as undefined, which is indistinguishable from an empty meeting.
 */
function fakeClient(tables: {
  participants?: Result;
  principals?: Result;
  onIn?: (ids: string[]) => void;
}) {
  const seen: string[] = [];
  const from = (table: string) => {
    seen.push(table);
    const result: Result =
      table === "live_meeting_participants"
        ? tables.participants ?? { data: [], error: null }
        : tables.principals ?? { data: [], error: null };

    const builder: Record<string, unknown> = {
      then: (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.in = (_column: string, ids: string[]) => {
      tables.onIn?.(ids);
      return builder;
    };
    return builder;
  };
  return { client: { from } as never, seen };
}

const rows = (...list: Array<{ user_id: string | null; display_name: string | null }>) => ({
  data: list,
  error: null,
});

describe("loadPresentPeople", () => {
  it("resolves a member's address out of the directory", async () => {
    const { client } = fakeClient({
      participants: rows({ user_id: "u1", display_name: "sarah (laptop)" }),
      principals: { data: [{ id: "u1", email: "Sarah@Fund.test", full_name: "Sarah Chen" }], error: null },
    });

    // The directory's name, not the one typed into a join screen, and the
    // address lowercased so the de-duplication downstream can rely on it.
    expect(await loadPresentPeople(client, "m1")).toEqual([
      { name: "Sarah Chen", email: "sarah@fund.test" },
    ]);
  });

  it("returns a guest as somebody with no address, rather than not at all", async () => {
    // The whole point: a guest who joined by link was in the meeting and cannot
    // be emailed, and the host is the only person who can reach them.
    const { client, seen } = fakeClient({
      participants: rows({ user_id: null, display_name: "Dana" }),
    });
    expect(await loadPresentPeople(client, "m1")).toEqual([{ name: "Dana", email: null }]);
    // Nobody to look up, so the directory is not asked.
    expect(seen).toEqual(["live_meeting_participants"]);
  });

  it("names an attendance row that has no name", async () => {
    const { client } = fakeClient({ participants: rows({ user_id: null, display_name: "  " }) });
    expect(await loadPresentPeople(client, "m1")).toEqual([{ name: "Guest", email: null }]);
  });

  it("asks the directory once, for the members who were there", async () => {
    const asked: string[][] = [];
    const { client, seen } = fakeClient({
      participants: rows(
        { user_id: "u1", display_name: "A" },
        { user_id: "u2", display_name: "B" },
        { user_id: null, display_name: "Guest" },
      ),
      principals: { data: [], error: null },
      onIn: (ids) => asked.push(ids),
    });
    await loadPresentPeople(client, "m1");
    expect(asked).toEqual([["u1", "u2"]]);
    expect(seen.filter((t) => t === "principals")).toHaveLength(1);
  });

  it("keeps a member whose directory row is missing, without an address", async () => {
    // They were in the room. Saying so with no address is the truth; dropping
    // them is what made a send of two look complete in a meeting of four.
    const { client } = fakeClient({
      participants: rows({ user_id: "u1", display_name: "Sarah" }),
      principals: { data: [], error: null },
    });
    expect(await loadPresentPeople(client, "m1")).toEqual([{ name: "Sarah", email: null }]);
  });

  it("counts one person once however many rows they left", async () => {
    // Postgres treats NULLs as distinct, so the unique index on
    // (meeting_id, user_id) does not constrain guest rows at all.
    const { client } = fakeClient({
      participants: rows(
        { user_id: null, display_name: "Dana" },
        { user_id: null, display_name: "dana" },
        { user_id: "u1", display_name: "Sarah" },
        { user_id: "u1", display_name: "Sarah" },
      ),
      principals: { data: [{ id: "u1", email: "s@fund.test", full_name: "Sarah" }], error: null },
    });
    expect(await loadPresentPeople(client, "m1")).toEqual([
      { name: "Dana", email: null },
      { name: "Sarah", email: "s@fund.test" },
    ]);
  });

  it("stops at the ceiling rather than reading a runaway table", async () => {
    const many = Array.from({ length: PRESENT_LIMIT + 50 }, (_, i) => ({
      user_id: `u${i}`,
      display_name: `P${i}`,
    }));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient({ participants: { data: many, error: null } });
    const people = await loadPresentPeople(client, "m1");
    expect(people).toHaveLength(PRESENT_LIMIT);
    // And it says so: an email that reaches two hundred of a larger room and
    // reports itself complete is the failure worth avoiding.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("when a query fails", () => {
    it("gives back nothing rather than throwing the email away", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const { client } = fakeClient({
        participants: { data: null, error: { message: "permission denied" } },
      });
      expect(await loadPresentPeople(client, "m1")).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("keeps the names when only the directory fails", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const { client } = fakeClient({
        participants: rows({ user_id: "u1", display_name: "Sarah" }),
        principals: { data: null, error: { message: "boom" } },
      });
      expect(await loadPresentPeople(client, "m1")).toEqual([{ name: "Sarah", email: null }]);
      warn.mockRestore();
    });

    it("survives a client that throws", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const client = {
        from: () => {
          throw new Error("no connection");
        },
      } as never;
      expect(await loadPresentPeople(client, "m1")).toEqual([]);
      warn.mockRestore();
    });
  });
});
