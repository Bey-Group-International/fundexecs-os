import {
  buildMfaState,
  mfaEnforcementEnabled,
  mfaGate,
  mfaRequiredForRole,
  normalizeTotpCode,
  verifiedTotpFactors,
} from "@/lib/mfa";

const verified = { id: "f1", factor_type: "totp", status: "verified" };
const unverified = { id: "f2", factor_type: "totp", status: "unverified" };

describe("mfaEnforcementEnabled", () => {
  it("is on unless explicitly turned off", () => {
    expect(mfaEnforcementEnabled({})).toBe(true);
    expect(mfaEnforcementEnabled({ MFA_ENFORCEMENT: "on" })).toBe(true);
    expect(mfaEnforcementEnabled({ MFA_ENFORCEMENT: "garbage" })).toBe(true);
    expect(mfaEnforcementEnabled({ MFA_ENFORCEMENT: " OFF " })).toBe(false);
  });
});

describe("mfaRequiredForRole", () => {
  it("requires owners and admins only", () => {
    expect(mfaRequiredForRole("owner", true)).toBe(true);
    expect(mfaRequiredForRole("admin", true)).toBe(true);
    expect(mfaRequiredForRole("member", true)).toBe(false);
    expect(mfaRequiredForRole("viewer", true)).toBe(false);
    expect(mfaRequiredForRole(null, true)).toBe(false);
  });
  it("requires nobody when enforcement is off", () => {
    expect(mfaRequiredForRole("owner", false)).toBe(false);
  });
});

describe("verifiedTotpFactors", () => {
  it("ignores unfinished enrollments and other factor types", () => {
    expect(verifiedTotpFactors([verified, unverified, { id: "p", factor_type: "phone", status: "verified" }])).toEqual([verified]);
    expect(verifiedTotpFactors(null)).toEqual([]);
  });
});

describe("mfaGate", () => {
  const state = (role: "owner" | "member", factors: typeof verified[], level: "aal1" | "aal2" | null) =>
    buildMfaState({ role, factors, level, enforcement: true });

  it("sends an owner with no factor to enroll", () => {
    expect(mfaGate(state("owner", [], "aal1"))).toBe("enroll");
  });
  it("does not count an unfinished enrollment as a factor", () => {
    expect(mfaGate(buildMfaState({ role: "admin", factors: [unverified], level: "aal1", enforcement: true }))).toBe("enroll");
  });
  it("challenges an enrolled owner whose session is only aal1", () => {
    expect(mfaGate(state("owner", [verified], "aal1"))).toBe("challenge");
  });
  it("fails closed when the level is unknown but a factor exists", () => {
    expect(mfaGate(state("owner", [verified], null))).toBe("challenge");
  });
  it("lets an enrolled owner through at aal2", () => {
    expect(mfaGate(state("owner", [verified], "aal2"))).toBe("ok");
  });
  it("leaves a member with no factor alone", () => {
    expect(mfaGate(state("member", [], "aal1"))).toBe("ok");
  });
  it("still challenges a member who chose to enroll", () => {
    expect(mfaGate(state("member", [verified], "aal1"))).toBe("challenge");
  });
  it("with enforcement off, an unenrolled owner passes but an enrolled one is still challenged", () => {
    expect(mfaGate(buildMfaState({ role: "owner", factors: [], level: "aal1", enforcement: false }))).toBe("ok");
    expect(mfaGate(buildMfaState({ role: "owner", factors: [verified], level: "aal1", enforcement: false }))).toBe("challenge");
  });
});

describe("normalizeTotpCode", () => {
  it("accepts six digits, tolerating pasted spaces", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
    expect(normalizeTotpCode("123 456")).toBe("123456");
  });
  it("rejects anything else", () => {
    for (const bad of ["12345", "1234567", "abcdef", "", null, undefined, 123456]) {
      expect(normalizeTotpCode(bad)).toBeNull();
    }
  });
});
