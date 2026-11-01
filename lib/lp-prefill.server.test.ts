jest.mock("server-only", () => ({}), { virtual: true });
import { loadDetailsPrefill } from "./lp-prefill.server";

let row: unknown;
let error: { message: string } | null;
let thrown: Error | null;
let seen: { table: string; select: string; filters: Array<[string, unknown]> };

const client = {
  from(table: string) {
    seen = { table, select: "", filters: [] };
    const q: Record<string, unknown> = {
      select: (s: string) => ((seen.select = s), q),
      eq: (c: string, v: unknown) => (seen.filters.push([c, v]), q),
      maybeSingle: async () => {
        if (thrown) throw thrown;
        return { data: row, error };
      },
    };
    return q;
  },
} as never;

const args = { orgId: "org-1", investorId: "inv-1", lpType: "entity" as const };

beforeEach(() => {
  row = { name: "Harbor LLC", investor_type: "family_office", contact_name: "Dana", contact_phone: "555", role: "MD" };
  error = null;
  thrown = null;
  seen = { table: "", select: "", filters: [] };
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("loadDetailsPrefill", () => {
  it("reads the allocator the link was made from, in its own organization, and only contact columns", async () => {
    const res = await loadDetailsPrefill(client, args);
    expect(res).toMatchObject({ legalName: "Harbor LLC", signatoryName: "Dana" });
    expect(seen.table).toBe("investors");
    expect(seen.filters).toEqual(expect.arrayContaining([["id", "inv-1"], ["organization_id", "org-1"]]));
    expect(seen.select).not.toMatch(/notes|aum|pipeline|typical_check/);
  });

  it("reads nothing for a link that wasn't made from an allocator", async () => {
    expect(await loadDetailsPrefill(client, { ...args, investorId: null })).toEqual({});
    expect(seen.table).toBe("");
  });

  it("suggests nothing when the allocator isn't found, e.g. it's in another organization", async () => {
    row = null;
    expect(await loadDetailsPrefill(client, args)).toEqual({});
  });

  it("never throws: a failed read is logged and the LP sees a blank form", async () => {
    error = { message: "boom" };
    await expect(loadDetailsPrefill(client, args)).resolves.toEqual({});
    expect(console.error).toHaveBeenCalled();
    error = null;
    thrown = new Error("network");
    await expect(loadDetailsPrefill(client, args)).resolves.toEqual({});
  });
});
