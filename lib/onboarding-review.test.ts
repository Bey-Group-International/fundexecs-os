import {
  REQUIRED_KINDS,
  approvalBlocker,
  describeAudit,
  isClear,
  reviewReadiness,
  validateCheckInput,
  validateDecisionInput,
  type CheckState,
} from "./onboarding-review";

const NOW = new Date("2026-10-31T12:00:00Z").getTime();
const clear = (kind: CheckState["kind"], expires_at: string | null = null): CheckState => ({ kind, status: "clear", expires_at });
const allClear = () => REQUIRED_KINDS.map((k) => clear(k));

describe("isClear", () => {
  it("needs a clear status", () => {
    expect(isClear(clear("identity"), NOW)).toBe(true);
    expect(isClear({ kind: "identity", status: "flagged", expires_at: null }, NOW)).toBe(false);
    expect(isClear(undefined, NOW)).toBe(false);
  });

  it("stops counting once the clearance has expired", () => {
    expect(isClear(clear("identity", "2026-11-30T00:00:00Z"), NOW)).toBe(true);
    expect(isClear(clear("identity", "2026-10-01T00:00:00Z"), NOW)).toBe(false);
  });
});

describe("reviewReadiness", () => {
  it("is ready when every required check is clear", () => {
    expect(reviewReadiness(allClear(), NOW)).toEqual({ ready: true, notDone: [], flagged: [], expired: [] });
  });

  it("does not require the optional litigation search", () => {
    expect(REQUIRED_KINDS).not.toContain("litigation");
    expect(reviewReadiness(allClear(), NOW).ready).toBe(true);
  });

  it("lists checks nobody has done, including ones still marked not done", () => {
    const checks: CheckState[] = allClear()
      .filter((c) => c.kind !== "sanctions") // never recorded
      .map((c) => (c.kind === "pep" ? { ...c, status: "pending" as const } : c)); // recorded as not done
    const r = reviewReadiness(checks, NOW);
    expect(r.ready).toBe(false);
    expect(r.notDone.sort()).toEqual(["pep", "sanctions"]);
  });

  it("separates flagged and failed results from the ones not done", () => {
    const checks = allClear().map((c) => (c.kind === "adverse_media" ? { ...c, status: "flagged" as const } : c.kind === "identity" ? { ...c, status: "failed" as const } : c));
    const r = reviewReadiness(checks, NOW);
    expect(r.flagged.sort()).toEqual(["adverse_media", "identity"]);
    expect(r.notDone).toEqual([]);
  });

  it("separates expired clearances", () => {
    const checks = allClear().map((c) => (c.kind === "accreditation" ? clear("accreditation", "2026-01-01T00:00:00Z") : c));
    const r = reviewReadiness(checks, NOW);
    expect(r.expired).toEqual(["accreditation"]);
    expect(r.ready).toBe(false);
  });

  it("is not ready with no checks at all", () => {
    const r = reviewReadiness([], NOW);
    expect(r.ready).toBe(false);
    expect(r.notDone.sort()).toEqual([...REQUIRED_KINDS].sort());
  });
});

describe("approvalBlocker", () => {
  it("says nothing when ready", () => {
    expect(approvalBlocker(reviewReadiness(allClear(), NOW))).toBeNull();
  });

  it("names what is flagged, not done and expired", () => {
    const checks: CheckState[] = [
      clear("identity"),
      { kind: "sanctions", status: "flagged", expires_at: null },
      clear("pep", "2026-01-01T00:00:00Z"),
    ];
    const text = approvalBlocker(reviewReadiness(checks, NOW))!;
    expect(text).toContain("flagged: Sanctions");
    expect(text).toContain("not done: Adverse media, Accreditation");
    expect(text).toContain("expired: Politically exposed");
  });
});

describe("validateCheckInput", () => {
  const ok = { sessionId: "s1", kind: "identity", status: "clear", summary: "  ID matched  ", validForDays: 90 };

  it("accepts a clear check and trims the note", () => {
    expect(validateCheckInput(ok)).toEqual({
      ok: true,
      value: { sessionId: "s1", kind: "identity", status: "clear", summary: "ID matched", validForDays: 90 },
    });
  });

  it("allows a clear check with no note and no expiry", () => {
    const r = validateCheckInput({ ...ok, summary: "", validForDays: null });
    expect(r).toMatchObject({ ok: true, value: { summary: null, validForDays: null } });
  });

  it("rejects an unknown kind or status, or no LP", () => {
    expect(validateCheckInput({ ...ok, kind: "credit_score" })).toEqual({ ok: false, error: "Unknown check." });
    expect(validateCheckInput({ ...ok, status: "maybe" })).toEqual({ ok: false, error: "Unknown status." });
    expect(validateCheckInput({ ...ok, sessionId: "" })).toEqual({ ok: false, error: "Choose an LP." });
    expect(validateCheckInput(null)).toEqual({ ok: false, error: "Choose an LP." });
  });

  it("insists on a note for a flagged or failed result", () => {
    expect(validateCheckInput({ ...ok, status: "flagged", summary: " " }).ok).toBe(false);
    expect(validateCheckInput({ ...ok, status: "failed", summary: "" }).ok).toBe(false);
    expect(validateCheckInput({ ...ok, status: "flagged", summary: "Name on a watch list" }).ok).toBe(true);
  });

  it("limits the note and the validity period", () => {
    expect(validateCheckInput({ ...ok, summary: "x".repeat(501) }).ok).toBe(false);
    expect(validateCheckInput({ ...ok, validForDays: 0 }).ok).toBe(false);
    expect(validateCheckInput({ ...ok, validForDays: 1.5 }).ok).toBe(false);
    expect(validateCheckInput({ ...ok, validForDays: 4000 }).ok).toBe(false);
  });
});

describe("validateDecisionInput", () => {
  const ok = { sessionId: "s1", decision: "approved", reason: "  All checks clear  " };

  it("accepts a decision and trims the reasoning", () => {
    expect(validateDecisionInput(ok)).toEqual({ ok: true, value: { sessionId: "s1", decision: "approved", reason: "All checks clear" } });
  });

  it("requires reasoning, within the limit", () => {
    expect(validateDecisionInput({ ...ok, reason: "   " }).ok).toBe(false);
    expect(validateDecisionInput({ ...ok, reason: "x".repeat(2001) }).ok).toBe(false);
  });

  it("rejects an unknown decision", () => {
    expect(validateDecisionInput({ ...ok, decision: "maybe" })).toEqual({ ok: false, error: "Choose a decision." });
  });
});

describe("describeAudit", () => {
  it("reads ids and statuses into a sentence", () => {
    expect(describeAudit("check.recorded", { kind: "identity", status: "clear" })).toBe("Identity check recorded as clear");
    expect(describeAudit("check.updated", { kind: "pep", from: "pending", to: "flagged" })).toBe("Politically exposed check changed from pending to flagged");
    expect(describeAudit("decision.recorded", { decision: "more_info" })).toBe("Decision recorded: more info");
    expect(describeAudit("something.else", null)).toBe("something.else");
  });
});
