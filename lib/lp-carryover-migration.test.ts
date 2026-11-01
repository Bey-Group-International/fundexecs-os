import { readFileSync } from "fs";

// SQL-text guards for supabase/migrations/20261101160000_lp_identity_carryover.sql.
// They check what the file says, not what a database does with it.
const sql = readFileSync("supabase/migrations/20261101160000_lp_identity_carryover.sql", "utf8");

describe("lp_identity_carryover migration", () => {
  it("is readable by organization owners and admins only, and writable by no signed-in user", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/for select using \(public\.is_org_admin\(organization_id\)\)/);
    expect(sql).toMatch(/revoke all on public\.lp_identity_carryover from anon/);
    expect(sql).toMatch(/revoke insert, update, delete on public\.lp_identity_carryover from authenticated/);
  });
  it("is tied to its onboarding's own organization and goes when that onboarding is erased", () => {
    expect(sql).toMatch(/foreign key \(session_id, organization_id\)\s+references public\.lp_onboarding_sessions \(id, organization_id\) on delete cascade/);
  });
  it("starts open, and can only ever hold the ID check", () => {
    expect(sql).toMatch(/status\s+text not null default 'proposed'/);
    expect(sql).toMatch(/kind = 'identity'/);
  });
});
