import { isVerifiedPrincipalRow } from "./identity";

// The identity gate's meaning lives in the pure predicate: a principal is
// identity-verified iff it carries a non-null identity_verified_at. The async
// reader (isPrincipalIdentityVerified) and the reputation coupling both lean on
// this, so it's worth pinning down precisely.
describe("isVerifiedPrincipalRow", () => {
  it("is true when identity_verified_at is set", () => {
    expect(isVerifiedPrincipalRow({ identity_verified_at: "2026-06-22T00:00:00Z" })).toBe(true);
  });

  it("is false when identity_verified_at is null", () => {
    expect(isVerifiedPrincipalRow({ identity_verified_at: null })).toBe(false);
  });

  it("is false for a null/undefined row (defensive)", () => {
    expect(isVerifiedPrincipalRow(null)).toBe(false);
    expect(isVerifiedPrincipalRow(undefined)).toBe(false);
  });
});
