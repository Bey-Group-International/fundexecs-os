// The parser that decides whether a request is carrying a referral code. The
// middleware writes a cookie off the back of it on every matched request, so
// what it refuses matters as much as what it accepts.

import { normalizeReferralCode, referralCodeFromJoinPath } from "@/lib/referral-link";

describe("normalizeReferralCode", () => {
  it("upper-cases and trims a code however it was retyped", () => {
    expect(normalizeReferralCode("  k7m2qx4p ")).toBe("K7M2QX4P");
    expect(normalizeReferralCode("K7M2QX4P")).toBe("K7M2QX4P");
  });

  it("rejects anything not shaped like a code", () => {
    for (const raw of ["", "   ", null, undefined, "a b", "K7M2/QX4P", "K7M2-QX4P", "%", "../admin"]) {
      expect(normalizeReferralCode(raw)).toBeNull();
    }
  });

  it("rejects a code longer than any we would issue", () => {
    expect(normalizeReferralCode("A".repeat(32))).toBe("A".repeat(32));
    expect(normalizeReferralCode("A".repeat(33))).toBeNull();
  });
});

describe("referralCodeFromJoinPath", () => {
  it("reads the code out of an invite-page path", () => {
    expect(referralCodeFromJoinPath("/join/K7M2QX4P")).toBe("K7M2QX4P");
    expect(referralCodeFromJoinPath("/join/k7m2qx4p")).toBe("K7M2QX4P");
    expect(referralCodeFromJoinPath("/join/K7M2QX4P/")).toBe("K7M2QX4P");
  });

  it("decodes a percent-encoded segment, and refuses a malformed one", () => {
    expect(referralCodeFromJoinPath("/join/%4B7M2QX4P")).toBe("K7M2QX4P");
    // A stray "%" must not throw — the middleware runs on every request.
    expect(referralCodeFromJoinPath("/join/AB%")).toBeNull();
    expect(referralCodeFromJoinPath("/join/%E0%A4%A")).toBeNull();
  });

  it("ignores paths that are not an invite page", () => {
    for (const path of [
      "/join",
      "/join/",
      "/join/K7M2QX4P/extra",
      "/joiner/K7M2QX4P",
      "/login",
      "/",
    ]) {
      expect(referralCodeFromJoinPath(path)).toBeNull();
    }
  });

  it("refuses a segment that decodes to something other than a code", () => {
    expect(referralCodeFromJoinPath("/join/%2E%2E%2Fadmin")).toBeNull();
    expect(referralCodeFromJoinPath("/join/a%20b")).toBeNull();
  });
});
