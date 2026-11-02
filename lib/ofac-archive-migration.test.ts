// The archive bucket (SOC 2 G-7) must stay private and policy-free: only the
// service role may read or write the stored OFAC lists.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OFAC_ARCHIVE_BUCKET } from "./ofac.server";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }));

const sql = readFileSync(join(__dirname, "../supabase/migrations/20261101170000_ofac_list_archive.sql"), "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("ofac_list_archive migration", () => {
  it("creates the bucket the app writes to, private", () => {
    expect(code).toContain(`'${OFAC_ARCHIVE_BUCKET}'`);
    expect(code).toMatch(/public\s*=\s*false/);
    expect(code).not.toMatch(/public\s*=\s*true/);
  });
  it("adds no policy, so no signed-in user can read or write the objects", () => {
    expect(code).not.toMatch(/create\s+policy/i);
    expect(code).not.toMatch(/\bgrant\b/i);
  });
});
