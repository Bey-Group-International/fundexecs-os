import { canAdminOrg, canWriteOrg, requireOrgAdmin } from "./rbac";
import type { MemberRole } from "./supabase/database.types";

describe("rbac", () => {
  const roles: MemberRole[] = ["owner", "admin", "member", "viewer"];

  it("allows org writes for owner/admin/member only", () => {
    expect(roles.filter(canWriteOrg)).toEqual(["owner", "admin", "member"]);
  });

  it("allows admin exports for owner/admin only", () => {
    expect(roles.filter(canAdminOrg)).toEqual(["owner", "admin"]);
  });

  it("returns a typed admin denial", () => {
    expect(requireOrgAdmin("viewer")).toEqual({
      ok: false,
      status: 403,
      error: "Owner or admin role required",
    });
    expect(requireOrgAdmin("admin")).toEqual({ ok: true });
  });
});
