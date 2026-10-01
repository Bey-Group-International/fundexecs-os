import {
  CORRECTION_KEY,
  MAX_CORRECTION_CHARS,
  RESTORED_FROM_KEY,
  cleanCorrection,
  reportVersions,
  restoredAnalysis,
} from "@/lib/meetings/report-versions";

describe("cleanCorrection", () => {
  it("trims, and treats anything else as no correction", () => {
    expect(cleanCorrection("  The follow-up is to Jane  ")).toBe("The follow-up is to Jane");
    expect(cleanCorrection("   ")).toBe("");
    expect(cleanCorrection(42)).toBe("");
    expect(cleanCorrection(undefined)).toBe("");
  });

  it("caps a note that is no longer a note", () => {
    expect(cleanCorrection("x".repeat(MAX_CORRECTION_CHARS + 50)).length).toBe(MAX_CORRECTION_CHARS);
  });
});

describe("reportVersions", () => {
  const rows = [
    {
      id: "r3",
      created_at: "2026-10-01T12:00:00Z",
      summary: "Restored summary",
      analysis: { follow_up_draft: "Hi", [RESTORED_FROM_KEY]: "r1" },
    },
    {
      id: "r2",
      created_at: "2026-10-01T11:00:00Z",
      summary: "Corrected summary",
      analysis: { follow_up_draft: "Hello", [CORRECTION_KEY]: "Send it to Jane" },
    },
    { id: "r1", created_at: "2026-10-01T10:00:00Z", summary: null, analysis: null },
  ];

  it("marks the newest as current and only the newest", () => {
    expect(reportVersions(rows).map((v) => v.current)).toEqual([true, false, false]);
  });

  it("carries the correction and the restore each version came from", () => {
    const [restored, corrected, original] = reportVersions(rows);
    expect(restored.restoredFrom).toBe("r1");
    expect(restored.correction).toBeNull();
    expect(corrected.correction).toBe("Send it to Jane");
    expect(corrected.followUp).toBe("Hello");
    expect(original).toMatchObject({ summary: "", followUp: "", correction: null, restoredFrom: null });
  });
});

describe("restoredAnalysis", () => {
  it("copies the version, marks where it came from, and drops its old correction", () => {
    const out = restoredAnalysis({ summary: "s", follow_up_draft: "d", [CORRECTION_KEY]: "old" }, "r1");
    expect(out).toEqual({ summary: "s", follow_up_draft: "d", [RESTORED_FROM_KEY]: "r1" });
  });

  it("survives a version with no analysis at all", () => {
    expect(restoredAnalysis(null, "r1")).toEqual({ [RESTORED_FROM_KEY]: "r1" });
  });
});
