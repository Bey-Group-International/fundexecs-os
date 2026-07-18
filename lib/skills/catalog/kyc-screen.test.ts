// Golden tests for the kyc-screen deterministic core. This skill is KYC/AML
// screening SUPPORT: it evaluates a rules grid, flags gaps, and ROUTES
// EXCEPTIONS to a compliance officer. It NEVER approves onboarding and NEVER
// makes a final determination — its status is NEVER "approved". A fixed clock is
// passed via ctx.now so the expiry window is deterministic.
import { kycScreen, type KycScreenInput } from "./kyc-screen";
import type { SkillContext } from "@/lib/skills/types";

// 2026-07-18T00:00:00Z — the deterministic "now" for expiry comparisons.
const NOW = Date.parse("2026-07-18T00:00:00Z");
const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "risk_compliance", now: NOW };
const run = (input: KycScreenInput) => kycScreen.run(input, ctx);

describe("kyc-screen core", () => {
  it("clears a fully-documented, all-pass subject for review (never 'approved')", () => {
    const r = run({
      subjectName: "Jane Doe",
      subjectType: "individual",
      documents: [
        { type: "passport", present: true, expiresAt: "2030-01-01" },
        { type: "proof_of_address", present: true, expiresAt: "2027-01-01" },
      ],
      checks: [
        { name: "watchlist", result: "pass" },
        { name: "adverse_media", result: "pass" },
      ],
      pepFlag: false,
      sanctionsHit: false,
    });
    expect(r.structured.screeningStatus).toBe("clear_for_review");
    expect(r.structured.documentCompleteness).toBe(1);
    expect(r.structured.missingDocuments).toEqual([]);
    expect(r.structured.escalationReasons).toEqual([]);
    // The status is NEVER an approval — a compliance officer decides.
    expect(r.structured.screeningStatus).not.toBe("approved");
  });

  it("escalates on a sanctions hit and routes the exception to compliance", () => {
    const r = run({
      subjectName: "Shady Holdings Ltd",
      subjectType: "entity",
      documents: [{ type: "incorporation_cert", present: true }],
      checks: [{ name: "sanctions", result: "pass" }],
      pepFlag: false,
      sanctionsHit: true,
    });
    expect(r.structured.screeningStatus).toBe("escalate");
    expect(r.structured.escalationReasons).toContain("Sanctions hit");
  });

  it("escalates on a PEP flag", () => {
    const r = run({ subjectName: "Politically Exposed", documents: [{ type: "passport", present: true }], checks: [{ name: "watchlist", result: "pass" }], pepFlag: true, sanctionsHit: false });
    expect(r.structured.screeningStatus).toBe("escalate");
    expect(r.structured.escalationReasons).toContain("PEP flag");
  });

  it("escalates on a failed check and names it", () => {
    const r = run({
      subjectName: "Risky Co",
      documents: [{ type: "passport", present: true }],
      checks: [{ name: "adverse_media", result: "fail" }],
      pepFlag: false,
      sanctionsHit: false,
    });
    expect(r.structured.screeningStatus).toBe("escalate");
    expect(r.structured.failedChecks).toEqual(["adverse_media"]);
    expect(r.structured.escalationReasons).toContain("Failed check: adverse_media");
  });

  it("marks the file incomplete and FLAGS missing documents instead of inventing them", () => {
    const r = run({
      subjectName: "Partial Person",
      subjectType: "individual",
      documents: [
        { type: "passport", present: true },
        { type: "proof_of_address", present: false },
      ],
      checks: [{ name: "watchlist", result: "pass" }],
      pepFlag: false,
      sanctionsHit: false,
    });
    expect(r.structured.screeningStatus).toBe("incomplete");
    expect(r.structured.documentCompleteness).toBe(0.5); // 1 of 2 present
    expect(r.structured.missingDocuments).toEqual(["proof_of_address"]);
  });

  it("is incomplete when documents are absent, and flags every material field", () => {
    const r = run({ subjectName: "Bare Subject" });
    expect(r.structured.screeningStatus).toBe("incomplete");
    expect(r.structured.documentCompleteness).toBe(0);
    expect(r.structured.missingFields).toEqual(
      expect.arrayContaining(["Subject type", "Identity documents", "Screening checks", "PEP screening", "Sanctions screening"]),
    );
    // Nothing fabricated: no fact source carries a subject-type value.
    expect(r.sources.some((s) => s.label === "Subject type")).toBe(false);
  });

  it("is incomplete while a check is pending", () => {
    const r = run({
      subjectName: "Pending Checks",
      documents: [{ type: "passport", present: true }],
      checks: [{ name: "watchlist", result: "pending" }],
      pepFlag: false,
      sanctionsHit: false,
    });
    expect(r.structured.screeningStatus).toBe("incomplete");
  });

  it("flags documents that are expired or expiring within 30 days of the fixed clock", () => {
    const r = run({
      subjectName: "Expiry Test",
      documents: [
        { type: "expired_passport", present: true, expiresAt: "2026-06-01" }, // past
        { type: "soon_id", present: true, expiresAt: "2026-08-01" }, // within 30 days of 2026-07-18
        { type: "fresh_license", present: true, expiresAt: "2029-01-01" }, // far future
      ],
      checks: [{ name: "watchlist", result: "pass" }],
      pepFlag: false,
      sanctionsHit: false,
    });
    expect(r.structured.expiringDocuments).toEqual(expect.arrayContaining(["expired_passport", "soon_id"]));
    expect(r.structured.expiringDocuments).not.toContain("fresh_license");
  });

  it("GUARDRAIL: never approves and always defers the final determination to a compliance officer", () => {
    const inputs: KycScreenInput[] = [
      { subjectName: "Clean", subjectType: "individual", documents: [{ type: "passport", present: true }], checks: [{ name: "watchlist", result: "pass" }], pepFlag: false, sanctionsHit: false },
      { subjectName: "Escalated", documents: [{ type: "passport", present: true }], checks: [{ name: "x", result: "fail" }], pepFlag: true, sanctionsHit: true },
      { subjectName: "Bare" },
    ];
    for (const input of inputs) {
      const r = run(input);
      // Status is only ever one of the three support states — never an approval.
      expect(["clear_for_review", "incomplete", "escalate"]).toContain(r.structured.screeningStatus);
      expect(r.structured.screeningStatus).not.toBe("approved");
      expect(r.structured.screeningStatus).not.toBe("clear");
      // Every recommendation ends by deferring the final call to a compliance officer.
      expect(r.structured.recommendedAction).toMatch(/compliance officer makes the final onboarding determination/);
      // The narrative reinforces the guardrail.
      expect(r.narrative).toMatch(/never approves onboarding/);
    }
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ subjectName: "X" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
