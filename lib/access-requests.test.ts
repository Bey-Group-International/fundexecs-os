import { createHash } from "crypto";
import {
  blockedRedirectPath,
  decideAccess,
  decisionUrl,
  hashDecisionToken,
  isPlausibleEmail,
  mintDecisionToken,
  normalizeAccessRequest,
  normalizeEmail,
  DECISION_TOKEN_TTL_DAYS,
} from "@/lib/access-requests";
import { accessRequestEmail } from "@/lib/access-request-emails";

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

describe("decision tokens", () => {
  it("stores only a hash — the raw token never appears in what we persist", () => {
    const minted = mintDecisionToken();
    expect(minted.hash).not.toContain(minted.token);
    expect(minted.hash).toBe(
      createHash("sha256").update(minted.token).digest("hex"),
    );
    expect(minted.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints a distinct high-entropy token each time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => mintDecisionToken().token));
    expect(tokens.size).toBe(50);
    // 32 random bytes, base64url — no padding, URL-safe alphabet only.
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("expires the token after the documented TTL", () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    const minted = mintDecisionToken(now);
    const elapsedDays =
      (new Date(minted.expiresAt).getTime() - now.getTime()) / 86_400_000;
    expect(elapsedDays).toBe(DECISION_TOKEN_TTL_DAYS);
  });

  it("hashes deterministically so a link resolves to its row", () => {
    expect(hashDecisionToken("abc")).toBe(hashDecisionToken("abc"));
    expect(hashDecisionToken("abc")).not.toBe(hashDecisionToken("abd"));
  });
});

describe("decisionUrl", () => {
  it("points at the confirmation page, carrying token and intent", () => {
    const url = new URL(decisionUrl("tok+en/value", "approve"));
    expect(url.pathname).toBe("/access-decision");
    expect(url.searchParams.get("token")).toBe("tok+en/value");
    expect(url.searchParams.get("decision")).toBe("approve");
  });

  it("distinguishes the two buttons", () => {
    expect(decisionUrl("t", "decline")).toContain("decision=decline");
  });
});

describe("accessRequestEmail", () => {
  const base = {
    email: "alex@firm.com",
    fullName: "Alex Chen",
    firm: "Meridian",
    role: "Managing Partner",
    note: null,
    createdAt: "2026-09-06T00:00:00.000Z",
  };

  it("renders both decision buttons when a token was minted", () => {
    const { html } = accessRequestEmail({
      ...base,
      approveUrl: "https://example.com/access-decision?token=t&decision=approve",
      declineUrl: "https://example.com/access-decision?token=t&decision=decline",
    });
    expect(html).toContain("Approve access");
    expect(html).toContain("Decline");
    expect(html).toContain("decision=approve");
    expect(html).toContain("decision=decline");
    // The reader is told the link is a credential, not a convenience.
    expect(html).toContain("single-use");
  });

  it("falls back to an admin-console pointer when there is no token", () => {
    const { html } = accessRequestEmail(base);
    expect(html).not.toContain("Approve access");
    expect(html).toContain("/admin");
  });

  it("escapes requester-supplied text rather than interpolating markup", () => {
    const { html } = accessRequestEmail({
      ...base,
      fullName: '<img src=x onerror="alert(1)">',
      note: "<script>alert(2)</script>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).toContain("&lt;script&gt;");
  });
});
