import { pickActiveMembership } from "@/lib/active-org";

const mine = [
  { organization_id: "org-old", role: "owner" },
  { organization_id: "org-new", role: "member" },
];

describe("pickActiveMembership", () => {
  it("returns null when the person has no memberships", () => {
    expect(pickActiveMembership([], "org-old")).toBeNull();
  });

  it("falls back to the oldest membership when there is no preference", () => {
    expect(pickActiveMembership(mine, undefined)?.organization_id).toBe("org-old");
    expect(pickActiveMembership(mine, null)?.organization_id).toBe("org-old");
    expect(pickActiveMembership(mine, "")?.organization_id).toBe("org-old");
  });

  it("honours a preference that matches a membership", () => {
    const picked = pickActiveMembership(mine, "org-new");
    expect(picked?.organization_id).toBe("org-new");
    expect(picked?.role).toBe("member");
  });

  it("ignores a preference for an organization the person is not in", () => {
    expect(pickActiveMembership(mine, "someone-elses-org")?.organization_id).toBe("org-old");
  });
});
