/**
 * The three directories behind the attendee picker.
 *
 * Two things matter here. Past attendees are read out of each meeting's
 * `attendees` JSON, which is a blob the database does not constrain — a row can
 * be null, a string, or an object missing every field — so the parser must not
 * throw on any of it. And a source that fails must return nothing rather than
 * taking the other two down with it: a picker that goes blank because one
 * table is unavailable is worse than one offering a shorter list.
 */
import { loadPeopleDirectory } from "./people.server";

type Rows = { data: unknown; error: unknown };

/** A Supabase-ish builder whose terminal value is whatever `rows` says. */
function builder(rows: Rows) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, is: () => b, not: () => b, in: () => b,
    order: () => b, limit: () => b,
    then: (resolve: (v: Rows) => unknown) => resolve(rows),
  };
  return b;
}

function client(tables: Record<string, Rows | (() => never)>) {
  return {
    from: (table: string) => {
      const entry = tables[table];
      if (typeof entry === "function") entry();
      return builder((entry as Rows) ?? { data: [], error: null });
    },
  } as unknown as Parameters<typeof loadPeopleDirectory>[0];
}

const MEMBERS = { data: [{ principal_id: "p1" }], error: null };
const PRINCIPALS = {
  data: [{ full_name: "Ana Member", email: "Ana@Fund.test", title: "Partner", avatar_url: "http://a/x.png" }],
  error: null,
};

describe("loadPeopleDirectory", () => {
  it("returns teammates with their title and avatar, address normalised", async () => {
    const out = await loadPeopleDirectory(
      client({ organization_members: MEMBERS, principals: PRINCIPALS }),
      "org1",
    );
    expect(out).toEqual([
      {
        email: "ana@fund.test",
        name: "Ana Member",
        subtitle: "Partner",
        avatarUrl: "http://a/x.png",
        source: "member",
      },
    ]);
  });

  it("joins a contact's title and company into one subtitle line", async () => {
    const out = await loadPeopleDirectory(
      client({
        network_contacts: {
          data: [{ full_name: "Ben", email: "ben@out.test", title: "CFO", company: "Acme", avatar_url: null }],
          error: null,
        },
      }),
      "org1",
    );
    expect(out[0]).toMatchObject({ subtitle: "CFO · Acme", source: "contact" });
  });

  it("omits the subtitle entirely when a contact has neither title nor company", async () => {
    const out = await loadPeopleDirectory(
      client({
        network_contacts: {
          data: [{ full_name: "Ben", email: "ben@out.test", title: null, company: null, avatar_url: null }],
          error: null,
        },
      }),
      "org1",
    );
    expect(out[0].subtitle).toBeUndefined();
  });

  it("falls back to the address when a directory row has no name", async () => {
    const out = await loadPeopleDirectory(
      client({
        organization_members: MEMBERS,
        principals: { data: [{ full_name: null, email: "x@f.test", title: null, avatar_url: null }], error: null },
      }),
      "org1",
    );
    expect(out[0].name).toBe("x@f.test");
  });

  it("drops directory rows with no address — they cannot be invited", async () => {
    const out = await loadPeopleDirectory(
      client({
        organization_members: MEMBERS,
        principals: {
          data: [
            { full_name: "No Email", email: null, title: null, avatar_url: null },
            { full_name: "Blank", email: "   ", title: null, avatar_url: null },
          ],
          error: null,
        },
      }),
      "org1",
    );
    expect(out).toEqual([]);
  });

  it("reads past attendees out of the meetings' attendee blobs", async () => {
    const out = await loadPeopleDirectory(
      client({
        live_meetings: {
          data: [{ attendees: [{ name: "Cal Past", email: "Cal@Old.test" }] }],
          error: null,
        },
      }),
      "org1",
    );
    expect(out).toEqual([{ email: "cal@old.test", name: "Cal Past", source: "past" }]);
  });

  it("survives every shape the attendees blob can actually hold", async () => {
    const out = await loadPeopleDirectory(
      client({
        live_meetings: {
          data: [
            { attendees: null },
            { attendees: "not an array" },
            { attendees: [null, "string", 42, [], {}] },
            { attendees: [{ name: "No Email" }] },
            { attendees: [{ email: "  ok@guest.test  ", name: 7 }] },
          ],
          error: null,
        },
      }),
      "org1",
    );
    // Only the one row carrying a usable address survives, and a non-string
    // name falls back to the address rather than rendering "7".
    expect(out).toEqual([{ email: "ok@guest.test", name: "ok@guest.test", source: "past" }]);
  });

  it("keeps the other sources when one query errors", async () => {
    const out = await loadPeopleDirectory(
      client({
        organization_members: MEMBERS,
        principals: PRINCIPALS,
        network_contacts: { data: null, error: { message: "boom" } },
        live_meetings: { data: null, error: { message: "boom" } },
      }),
      "org1",
    );
    expect(out.map((p) => p.source)).toEqual(["member"]);
  });

  it("keeps the other sources when one query throws outright", async () => {
    const out = await loadPeopleDirectory(
      client({
        organization_members: MEMBERS,
        principals: PRINCIPALS,
        network_contacts: () => { throw new Error("connection reset"); },
      }),
      "org1",
    );
    expect(out.map((p) => p.source)).toEqual(["member"]);
  });

  it("does not query principals at all when the org has no members", async () => {
    let principalsHit = false;
    const supabase = {
      from: (table: string) => {
        if (table === "principals") principalsHit = true;
        if (table === "organization_members") return builder({ data: [], error: null });
        return builder({ data: [], error: null });
      },
    } as unknown as Parameters<typeof loadPeopleDirectory>[0];
    await loadPeopleDirectory(supabase, "org1");
    expect(principalsHit).toBe(false);
  });
});
