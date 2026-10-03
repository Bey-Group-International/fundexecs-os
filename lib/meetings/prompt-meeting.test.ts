import { roomCodeFromPath } from "./prompt-meeting";
import { meetingIdForRoom } from "./prompt-meeting.server";

describe("roomCodeFromPath", () => {
  it("reads the room off a meeting page and its sub-pages", () => {
    expect(roomCodeFromPath("/meetings/abc-123")).toBe("abc-123");
    expect(roomCodeFromPath("/meetings/abc-123/report")).toBe("abc-123");
  });
  it("ignores the meetings section's own pages and everything else", () => {
    expect(roomCodeFromPath("/meetings")).toBeNull();
    expect(roomCodeFromPath("/meetings/calls")).toBeNull();
    expect(roomCodeFromPath("/meetings/record/x")).toBeNull();
    expect(roomCodeFromPath("/inbox")).toBeNull();
    expect(roomCodeFromPath(null)).toBeNull();
  });
});

describe("meetingIdForRoom", () => {
  function client(row: unknown) {
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return chain;
      },
      is: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    });
    return { c: { from: () => chain } as never, filters };
  }

  it("resolves a room inside the caller's organisation", async () => {
    const { c, filters } = client({ id: "m1" });
    expect(await meetingIdForRoom(c, "org-1", "abc")).toBe("m1");
    expect(filters).toEqual([
      ["organization_id", "org-1"],
      ["room_code", "abc"],
    ]);
  });

  it("refuses anything that is not a room code, without a query", async () => {
    const { c, filters } = client({ id: "m1" });
    expect(await meetingIdForRoom(c, "org-1", "a b")).toBeNull();
    expect(await meetingIdForRoom(c, "org-1", 42)).toBeNull();
    expect(filters).toEqual([]);
  });
});
