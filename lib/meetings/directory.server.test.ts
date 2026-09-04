// Loading the directory is where the matcher's "unique-or-nothing" promise is
// actually kept or broken: it can only be unique across the whole organization
// if the whole organization was read.
import { loadOrgDirectory } from "./directory.server";

/**
 * A client whose organization_members reads page through `memberPages` and
 * whose principals reads answer from `principals` (or error when told to).
 */
function client(opts: {
  memberPages?: Array<Array<{ principal_id: string }>>;
  principals?: Array<{ full_name: string | null; email: string }>;
  membersError?: boolean;
  principalsError?: boolean;
}) {
  const pages = opts.memberPages ?? [];
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        range: async (from: number) => {
          if (opts.membersError) return { error: { message: "boom" } };
          return { data: pages[Math.floor(from / 500)] ?? [] };
        },
        in: async () => {
          if (opts.principalsError) return { error: { message: "boom" } };
          return { data: opts.principals ?? [] };
        },
      };
      void table;
      return b;
    },
  } as never;
}

const page = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ principal_id: `p${offset + i}` }));

describe("loadOrgDirectory", () => {
  it("returns the members it read", async () => {
    const out = await loadOrgDirectory(
      client({
        memberPages: [page(2)],
        principals: [
          { full_name: "Mike Ross", email: "mike.ross@fund.test" },
          { full_name: null, email: "rae@fund.test" },
        ],
      }),
      "org1",
    );
    expect(out).toEqual([
      { name: "Mike Ross", email: "mike.ross@fund.test" },
      { name: null, email: "rae@fund.test" },
    ]);
  });

  it("pages past the first read rather than stopping at it", async () => {
    // A full page means there may be more. Stopping there is what makes a name
    // that is ambiguous in the organization look unique in the half that loaded.
    const out = await loadOrgDirectory(
      client({
        memberPages: [page(500), page(1, 500)],
        principals: [{ full_name: "Mike Ross", email: "mike.ross@fund.test" }],
      }),
      "org1",
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it("fails closed when the directory is too large to read in full", async () => {
    // Nothing rather than something: against a partial directory the matcher's
    // uniqueness check can resolve an ambiguous name to the wrong colleague.
    const out = await loadOrgDirectory(
      client({
        memberPages: [page(500), page(500, 500), page(500, 1000)],
        principals: [{ full_name: "Mike Ross", email: "mike.ross@fund.test" }],
      }),
      "org1",
      // A ceiling smaller than the data, standing in for a very large org.
      600,
    );
    expect(out).toEqual([]);
  });

  it("fails closed on a read error rather than matching against a fragment", async () => {
    expect(await loadOrgDirectory(client({ membersError: true }), "org1")).toEqual([]);
    expect(
      await loadOrgDirectory(client({ memberPages: [page(2)], principalsError: true }), "org1"),
    ).toEqual([]);
  });

  it("returns nothing for an organization with no members", async () => {
    expect(await loadOrgDirectory(client({ memberPages: [[]] }), "org1")).toEqual([]);
  });

  it("drops members with no address", async () => {
    const out = await loadOrgDirectory(
      client({
        memberPages: [page(2)],
        principals: [
          { full_name: "Ghost", email: "   " },
          { full_name: "Rae", email: "rae@fund.test" },
        ],
      }),
      "org1",
    );
    expect(out).toEqual([{ name: "Rae", email: "rae@fund.test" }]);
  });
});
