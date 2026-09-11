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
import {
  APPLICANT_TYPES,
  fieldsFor,
  operatorRoleForApplicantType,
} from "@/lib/access-request-fields";

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
  const gp = (values: Record<string, string> = {}) => ({
    email: "alex@firm.com",
    applicantType: "gp",
    values: { organization_name: "Meridian", primary_strategy: "private_equity", ...values },
  });

  it("routes each answer to its typed column or to details", () => {
    const result = normalizeAccessRequest({
      email: " Alex@Firm.com ",
      fullName: "  Alex Chen ",
      applicantType: "family_office",
      values: {
        organization_name: " Meridian ",
        role: "Managing Partner",
        hq_location: "New York, NY",
        aum_range: "100m_500m",
        primary_strategy: "real_estate",
        check_size: "5m_25m",
        note: "  Fund II diligence ",
      },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.email).toBe("alex@firm.com");
    expect(result.value.applicant_type).toBe("family_office");
    expect(result.value.organization_name).toBe("Meridian");
    // Onboarding also asks these, so they get typed columns.
    expect(result.value.aum_range).toBe("100m_500m");
    expect(result.value.primary_strategy).toBe("real_estate");
    // Reviewer-only, so it lands in details.
    expect(result.value.details).toEqual({ check_size: "5m_25m" });
    expect(result.value.note).toBe("Fund II diligence");
  });

  it("rejects a missing or malformed email", () => {
    expect(normalizeAccessRequest({ ...gp(), email: "   " })).toEqual({
      ok: false,
      error: "Enter your work email.",
    });
    expect(normalizeAccessRequest({ ...gp(), email: "not-an-email" }).ok).toBe(false);
  });

  it("requires a known applicant type", () => {
    expect(normalizeAccessRequest({ email: "a@b.co" })).toEqual({
      ok: false,
      error: "Choose which best describes you.",
    });
    expect(
      normalizeAccessRequest({ email: "a@b.co", applicantType: "hedge_fund" }).ok,
    ).toBe(false);
  });

  it("names the field when a required answer is missing", () => {
    const result = normalizeAccessRequest({
      email: "alex@firm.com",
      applicantType: "advisory",
      values: { organization_name: "Meridian" },
    });
    expect(result).toEqual({ ok: false, error: "Service line is required." });
  });

  it("drops answers the chosen type was never asked for", () => {
    // A GP form has no service_line field, so a posted one is not stored.
    const result = normalizeAccessRequest(gp({ service_line: "legal" }));
    if (!result.ok) throw new Error(result.error);
    expect(result.value.details).toEqual({});
  });

  it("refuses a select value the form never offered", () => {
    expect(normalizeAccessRequest(gp({ aum_range: "over_9000" })).ok).toBe(false);
    expect(normalizeAccessRequest(gp({ primary_strategy: "crypto" })).ok).toBe(false);
  });

  it("takes a whole-number fund count and rejects nonsense", () => {
    const ok = normalizeAccessRequest(gp({ fund_count: "3" }));
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.value.fund_count).toBe(3);
    expect(normalizeAccessRequest(gp({ fund_count: "-2" })).ok).toBe(false);
    expect(normalizeAccessRequest(gp({ fund_count: "two" })).ok).toBe(false);
  });

  it("clamps free text rather than persisting an unbounded form post", () => {
    const result = normalizeAccessRequest(
      gp({ organization_name: "x".repeat(500), note: "y".repeat(5000) }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.organization_name).toHaveLength(200);
    expect(result.value.note).toHaveLength(2000);
  });
});

describe("operatorRoleForApplicantType", () => {
  it("maps the four types onboarding already models", () => {
    expect(operatorRoleForApplicantType("gp")).toBe("gp");
    expect(operatorRoleForApplicantType("family_office")).toBe("family_office");
    expect(operatorRoleForApplicantType("advisory")).toBe("advisory");
    expect(operatorRoleForApplicantType("operator")).toBe("operator");
  });

  it("returns null for the two with no operator_role — they pick in onboarding", () => {
    expect(operatorRoleForApplicantType("lp")).toBeNull();
    expect(operatorRoleForApplicantType("service_provider")).toBeNull();
    expect(operatorRoleForApplicantType(null)).toBeNull();
  });
});

describe("fieldsFor", () => {
  it("asks every type for the common block and the closing question", () => {
    for (const type of APPLICANT_TYPES) {
      const names = fieldsFor(type).map((f) => f.name);
      expect(names).toContain("organization_name");
      expect(names[names.length - 1]).toBe("note");
    }
  });

  it("asks a GP about funds and an advisor about their service line", () => {
    expect(fieldsFor("gp").map((f) => f.name)).toContain("fund_count");
    expect(fieldsFor("gp").map((f) => f.name)).not.toContain("service_line");
    expect(fieldsFor("advisory").map((f) => f.name)).toContain("service_line");
    expect(fieldsFor("advisory").map((f) => f.name)).not.toContain("fund_count");
  });

  it("never routes two fields of one type to the same typed column", () => {
    for (const type of APPLICANT_TYPES) {
      const columns = fieldsFor(type)
        .map((f) => f.column)
        .filter(Boolean);
      expect(new Set(columns).size).toBe(columns.length);
    }
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

  it("lets a decline outrank a standing approval stamp", () => {
    // The whole point of the ordering. Migration 20260906120000 backfilled
    // every principal existing then as approved, so a decline that lost to the
    // stamp could not revoke anyone who already had an account.
    expect(
      decideAccess({
        ...base,
        approvedAt: "2026-01-01T00:00:00Z",
        requestStatus: "declined",
      }),
    ).toBe("declined");
  });

  it("still gates a pending request behind the stamp, not ahead of it", () => {
    // Only a decline jumps the queue. An approved-then-stamped principal who
    // later files a fresh request must not be locked out by it.
    expect(
      decideAccess({
        ...base,
        approvedAt: "2026-01-01T00:00:00Z",
        requestStatus: "pending",
      }),
    ).toBe("allow");
  });

  it("never gates an internal email, even one carrying a declined row", () => {
    expect(
      decideAccess({ ...base, requestStatus: "declined", isInternal: true }),
    ).toBe("allow");
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

  it("falls back to the generic 'access required' notice", () => {
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
    applicantType: "gp" as const,
    organizationName: "Meridian",
    role: "Managing Partner",
    hqLocation: "New York, NY",
    aumRange: "100m_500m",
    fundCount: 2,
    primaryStrategy: "private_equity",
    details: {},
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

  it("shows the applicant type and the answers that type was asked for", () => {
    const { html } = accessRequestEmail({
      ...base,
      applicantType: "advisory",
      aumRange: null,
      fundCount: null,
      primaryStrategy: null,
      details: { service_line: "fund_admin", clients_served: "Emerging GPs" },
    });
    expect(html).toContain("Advisory / Placement");
    // details render with their form label and option label, not raw slugs.
    expect(html).toContain("Service line");
    expect(html).toContain("Fund administration");
    expect(html).toContain("Emerging GPs");
  });

  it("omits fields the applicant was never asked for rather than showing a dash", () => {
    const { html } = accessRequestEmail({
      ...base,
      aumRange: null,
      fundCount: null,
      primaryStrategy: null,
      hqLocation: null,
    });
    expect(html).not.toContain("AUM");
    expect(html).not.toContain("Funds raised");
    expect(html).not.toContain("Strategy");
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
