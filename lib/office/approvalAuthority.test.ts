import { memberRoleCanApprove, officeRoleFromMemberRole } from "./approvalAuthority";

describe("office approval authority (trusted org role → tier)", () => {
  it("permits capital-binding approvals only for owner/admin", () => {
    expect(memberRoleCanApprove("owner", "capital_binding")).toBe(true);
    expect(memberRoleCanApprove("admin", "capital_binding")).toBe(true);
    expect(memberRoleCanApprove("member", "capital_binding")).toBe(false);
    expect(memberRoleCanApprove("viewer", "capital_binding")).toBe(false);
    expect(memberRoleCanApprove(null, "capital_binding")).toBe(false);
  });

  it("permits external-facing approvals for owner/admin/member but not viewer", () => {
    expect(memberRoleCanApprove("owner", "external_facing")).toBe(true);
    expect(memberRoleCanApprove("admin", "external_facing")).toBe(true);
    expect(memberRoleCanApprove("member", "external_facing")).toBe(true);
    expect(memberRoleCanApprove("viewer", "external_facing")).toBe(false);
    expect(memberRoleCanApprove(null, "external_facing")).toBe(false);
  });

  it("maps membership roles to display office roles", () => {
    expect(officeRoleFromMemberRole("owner")).toBe("managing_partner");
    expect(officeRoleFromMemberRole("admin")).toBe("compliance");
    expect(officeRoleFromMemberRole("member")).toBe("principal");
    expect(officeRoleFromMemberRole("viewer")).toBe("observer");
    expect(officeRoleFromMemberRole(null)).toBe("observer");
  });
});
