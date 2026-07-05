import { emptyResearchContact, routeExecutiveRoles } from "./executive-team";

describe("executive team routing", () => {
  it("routes sourcing and contact discovery to Scout", () => {
    const roles = routeExecutiveRoles("Source 50 acquisition targets and verify founder contacts");
    expect(roles[0]).toMatchObject({
      role: "scout",
      approvalBoundary: "external_facing",
    });
  });

  it("routes legal and tax-sensitive work to controlled support roles", () => {
    const roles = routeExecutiveRoles("Review the side letter and tax considerations for this LP");
    expect(roles.map((r) => r.role)).toEqual(expect.arrayContaining(["tax_specialist", "legal_counsel"]));
    expect(roles.every((r) => r.approvalBoundary === "capital_binding")).toBe(true);
  });

  it("provides an explicit unavailable contact shell", () => {
    expect(emptyResearchContact()).toMatchObject({
      name: "Not publicly verified",
      email: "Not publicly verified",
      phone: "Not publicly verified",
      verification: "unavailable",
    });
  });
});
