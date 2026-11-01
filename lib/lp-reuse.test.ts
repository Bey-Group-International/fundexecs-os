import { REUSABLE_CHECK_KINDS, REUSE_WINDOW_DAYS, escapeLike, normalizeEmail, reusableChecks, type PriorCheck, type PriorSession } from "./lp-reuse";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const ahead = (days: number) => new Date(NOW + days * DAY).toISOString();

const approved: PriorSession = { id: "s-old", review_state: "approved" };
const idCheck = (over: Partial<PriorCheck> = {}): PriorCheck => ({
  session_id: "s-old",
  kind: "identity",
  status: "clear",
  method: "stripe_identity",
  vendor_ref: "vs_1",
  summary: "Government ID and selfie verified by Stripe Identity.",
  checked_at: ago(100),
  expires_at: ahead(265),
  ...over,
});

describe("what may be carried over", () => {
  it("is the government-ID check only: the checks that go stale are never reused", () => {
    expect(REUSABLE_CHECK_KINDS).toEqual(["identity"]);
    const everything: PriorCheck[] = (["identity", "sanctions", "pep", "adverse_media", "litigation", "accreditation"] as const).map((kind) => idCheck({ kind }));
    expect(reusableChecks([approved], everything, NOW).map((c) => c.kind)).toEqual(["identity"]);
  });
});

describe("reusableChecks", () => {
  it("carries a clear, unexpired ID check from an approved onboarding, keeping the original date and Stripe reference", () => {
    const [c] = reusableChecks([approved], [idCheck()], NOW);
    expect(c).toMatchObject({ kind: "identity", status: "clear", method: "stripe_identity", vendor_ref: "vs_1", checked_at: ago(100), fromSessionId: "s-old" });
    expect(c.expires_at).toBe(ahead(265));
    expect(c.summary).toMatch(/^Carried forward from the 2026-07-24 onboarding: Government ID/);
  });

  it("caps the validity at a year from when it was cleared, even if the fund manager set it longer or never", () => {
    expect(REUSE_WINDOW_DAYS).toBe(365);
    const longer = reusableChecks([approved], [idCheck({ expires_at: ahead(2000) })], NOW)[0];
    expect(longer.expires_at).toBe(new Date(NOW - 100 * DAY + 365 * DAY).toISOString());
    const never = reusableChecks([approved], [idCheck({ expires_at: null })], NOW)[0];
    expect(never.expires_at).toBe(longer.expires_at);
  });

  it("honours a shorter expiry the fund manager chose", () => {
    const c = reusableChecks([approved], [idCheck({ expires_at: ahead(30) })], NOW)[0];
    expect(c.expires_at).toBe(ahead(30));
  });

  it("carries nothing once it is expired or more than a year old", () => {
    expect(reusableChecks([approved], [idCheck({ expires_at: ago(1) })], NOW)).toEqual([]);
    expect(reusableChecks([approved], [idCheck({ checked_at: ago(366), expires_at: null })], NOW)).toEqual([]);
    expect(reusableChecks([approved], [idCheck({ checked_at: ago(364), expires_at: null })], NOW)).toHaveLength(1);
  });

  it("carries nothing that wasn't clear, or has no date", () => {
    for (const status of ["pending", "flagged", "failed"]) {
      expect(reusableChecks([approved], [idCheck({ status })], NOW)).toEqual([]);
    }
    expect(reusableChecks([approved], [idCheck({ checked_at: null })], NOW)).toEqual([]);
    expect(reusableChecks([approved], [idCheck({ checked_at: "nonsense" })], NOW)).toEqual([]);
  });

  it("needs the earlier onboarding to have been approved by a person", () => {
    for (const review_state of ["not_started", "in_progress", "submitted", "changes_requested"]) {
      expect(reusableChecks([{ id: "s-old", review_state }], [idCheck()], NOW)).toEqual([]);
    }
    expect(reusableChecks([], [idCheck()], NOW)).toEqual([]);
  });

  it("ignores checks that belong to a different onboarding than the approved one", () => {
    expect(reusableChecks([approved], [idCheck({ session_id: "s-other" })], NOW)).toEqual([]);
  });

  it("carries nothing for anyone who was ever rejected", () => {
    const sessions = [approved, { id: "s-bad", review_state: "rejected" }];
    expect(reusableChecks(sessions, [idCheck()], NOW)).toEqual([]);
  });

  it("takes the most recent clearance when there are several", () => {
    const sessions = [approved, { id: "s-newer", review_state: "approved" }];
    const checks = [idCheck({ checked_at: ago(200), expires_at: null }), idCheck({ session_id: "s-newer", checked_at: ago(20), vendor_ref: "vs_2", expires_at: null })];
    const [c] = reusableChecks(sessions, checks, NOW);
    expect(c.fromSessionId).toBe("s-newer");
    expect(c.vendor_ref).toBe("vs_2");
  });

  it("keeps the note within a check's 500 characters", () => {
    const [c] = reusableChecks([approved], [idCheck({ summary: "x".repeat(900) })], NOW);
    expect(c.summary.length).toBeLessThanOrEqual(500);
  });

  it("copes with a prior check that has no note", () => {
    expect(reusableChecks([approved], [idCheck({ summary: null })], NOW)[0].summary).toBe("Carried forward from the 2026-07-24 onboarding.");
  });
});

describe("email helpers", () => {
  it("normalizes case and spaces, and rejects non-text", () => {
    expect(normalizeEmail("  Jo@Example.COM ")).toBe("jo@example.com");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });

  it("escapes LIKE wildcards so an address can't match a different one", () => {
    expect(escapeLike("a_b%c\\d@x.com")).toBe("a\\_b\\%c\\\\d@x.com");
    expect(escapeLike("plain@x.com")).toBe("plain@x.com");
  });
});
