import { resolveShareAccess, shareScopeLabel, type ShareAccessInput } from "./session-share";

const base: ShareAccessInput = {
  scope: "public",
  shareOrgId: "org-1",
  viewer: null,
  viewerIsOrgMember: false,
};

describe("resolveShareAccess", () => {
  it("lets anyone read a public share, signed in or not", () => {
    expect(resolveShareAccess({ ...base, scope: "public" })).toBe("allow");
    expect(resolveShareAccess({ ...base, scope: "public", viewer: { userId: "u1" } })).toBe("allow");
  });

  it("asks a signed-out visitor to sign in for an org share", () => {
    expect(resolveShareAccess({ ...base, scope: "org", viewer: null })).toBe("sign_in");
  });

  it("lets a member of the sharing org read an org share", () => {
    expect(
      resolveShareAccess({ ...base, scope: "org", viewer: { userId: "u1" }, viewerIsOrgMember: true }),
    ).toBe("allow");
  });

  it("denies a signed-in viewer from another org", () => {
    // Not "sign_in" — that would confirm to an outsider that the token is real
    // and belongs to an org they aren't in.
    expect(
      resolveShareAccess({ ...base, scope: "org", viewer: { userId: "u2" }, viewerIsOrgMember: false }),
    ).toBe("deny");
  });

  it("denies when no share resolved for the token", () => {
    expect(resolveShareAccess({ ...base, scope: null })).toBe("deny");
    expect(resolveShareAccess({ ...base, scope: null, viewer: { userId: "u1" }, viewerIsOrgMember: true })).toBe("deny");
  });

  it("denies an org share with no owning org rather than falling open", () => {
    expect(
      resolveShareAccess({ ...base, scope: "org", shareOrgId: null, viewer: { userId: "u1" }, viewerIsOrgMember: true }),
    ).toBe("deny");
  });

  it("denies an unrecognised scope", () => {
    // A row written by a future migration must not read as public.
    expect(
      resolveShareAccess({ ...base, scope: "everyone" as unknown as "public", viewer: { userId: "u1" } }),
    ).toBe("deny");
  });
});

describe("shareScopeLabel", () => {
  it("never misdescribes an org share as public", () => {
    expect(shareScopeLabel("public")).toBe("Shared read-only");
    expect(shareScopeLabel("org")).toBe("Shared with your team");
  });
});
