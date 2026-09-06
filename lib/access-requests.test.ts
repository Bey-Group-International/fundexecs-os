import {
  blockedRedirectPath,
  decideAccess,
  isPlausibleEmail,
  normalizeAccessRequest,
  normalizeEmail,
} from "@/lib/access-requests";

describe("normalizeEmail", () => {
  it("lowercases and trims so the queue's unique constraint dedupes", () => {
    expect(normalizeEmail("  Alex@Firm.COM ")).toBe("alex@firm.com");
  });

  it("treats null/undefined as empty", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("isPlausibleEmail", () => {
  it.each(["a@b.co", "alex.chen@meridian-capital.com"])("accepts %s", (email) => {
    expect(isPlausibleEmail(email)).toBe(true);
  });

  it.each(["", "alex", "alex@firm", "alex@@firm.com", "alex @firm.com"])(
    "rejects %s",
    (email) => {
      expect(isPlausibleEmail(email)).toBe(false);
    },
  );
});

describe("normalizeAccessRequest", () => {
  it("normalizes the email and trims the optional fields", () => {
    const result = normalizeAccessRequest({
      email: " Alex@Firm.com ",
      fullName: "  Alex Chen ",
      firm: " Meridian ",
      role: "",
      note: "  Fund II diligence ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        email: "alex@firm.com",
        full_name: "Alex Chen",
        firm: "Meridian",
        role: null,
        note: "Fund II diligence",
      },
    });
  });

  it("rejects a missing or malformed email", () => {
    expect(normalizeAccessRequest({ email: "   " })).toEqual({
      ok: false,
      error: "Enter your work email.",
    });
    expect(normalizeAccessRequest({ email: "not-an-email" }).ok).toBe(false);
  });

  it("clamps free text rather than persisting an unbounded form post", () => {
    const result = normalizeAccessRequest({
      email: "alex@firm.com",
      firm: "x".repeat(500),
      note: "y".repeat(5000),
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.firm).toHaveLength(200);
    expect(result.value.note).toHaveLength(2000);
  });
});

describe("decideAccess", () => {
  const base = { approvedAt: null, requestStatus: null, isInternal: false } as const;

  it("never gates the internal team, even on a brand-new account", () => {
    expect(decideAccess({ ...base, isInternal: true })).toBe("allow");
  });

  it("allows an already-approved principal", () => {
    expect(decideAccess({ ...base, approvedAt: "2026-01-01T00:00:00Z" })).toBe("allow");
  });

  it("grants (and stamps) when the request was approved but the principal wasn't", () => {
    expect(decideAccess({ ...base, requestStatus: "approved" })).toBe("grant");
  });

  it("blocks a pending or declined request", () => {
    expect(decideAccess({ ...base, requestStatus: "pending" })).toBe("pending");
    expect(decideAccess({ ...base, requestStatus: "declined" })).toBe("declined");
  });

  it("blocks a sign-in that never asked for access — the Google self-serve hole", () => {
    expect(decideAccess(base)).toBe("none");
  });
});

describe("blockedRedirectPath", () => {
  it("carries the reason and the email so the form explains itself", () => {
    expect(blockedRedirectPath("pending", "alex@firm.com")).toBe(
      "/request-access?email=alex%40firm.com&status=pending",
    );
    expect(blockedRedirectPath("declined", "alex@firm.com")).toContain("status=declined");
  });

  it("falls back to the generic 'invite-only' notice", () => {
    expect(blockedRedirectPath("none", "")).toBe("/request-access?status=required");
  });
});
