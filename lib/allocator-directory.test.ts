// lib/allocator-directory.test.ts
import {
  ALLOCATOR_TYPE_LABELS,
  ACCREDITATION_LABELS,
  ACCREDITATION_COLORS,
  formatAUM,
  formatTicketRange,
  fitScoreColor,
  type AllocatorType,
  type AccreditationStatus,
} from "@/lib/allocator-directory";

// --- ALLOCATOR_TYPE_LABELS ---------------------------------------------------
describe("ALLOCATOR_TYPE_LABELS", () => {
  it("has a label for each allocator type", () => {
    const types: AllocatorType[] = [
      "family_office", "ria", "endowment", "foundation",
      "pension", "sovereign", "fund_of_funds", "institutional", "other",
    ];
    for (const t of types) {
      expect(ALLOCATOR_TYPE_LABELS[t]).toBeTruthy();
    }
  });

  it("family_office maps to 'Family Office'", () => {
    expect(ALLOCATOR_TYPE_LABELS.family_office).toBe("Family Office");
  });
});

// --- ACCREDITATION_LABELS & COLORS -------------------------------------------
describe("ACCREDITATION_LABELS", () => {
  it("has labels for all accreditation statuses", () => {
    const statuses: AccreditationStatus[] = [
      "unknown", "accredited_investor", "qualified_purchaser",
      "qualified_client", "institutional", "pending_verification",
    ];
    for (const s of statuses) {
      expect(ACCREDITATION_LABELS[s]).toBeTruthy();
      expect(ACCREDITATION_COLORS[s]).toBeTruthy();
    }
  });
});

// --- formatAUM ---------------------------------------------------------------
describe("formatAUM", () => {
  it("returns — for null/undefined/0", () => {
    expect(formatAUM(null)).toBe("—");
    expect(formatAUM(undefined)).toBe("—");
    expect(formatAUM(0)).toBe("—");
  });

  it("formats billions correctly", () => {
    expect(formatAUM(1_500_000_000)).toBe("$1.5B");
  });

  it("formats millions correctly", () => {
    expect(formatAUM(250_000_000)).toBe("$250M");
  });

  it("formats thousands correctly", () => {
    expect(formatAUM(500_000)).toBe("$500K");
  });

  it("formats small amounts as dollars", () => {
    expect(formatAUM(999)).toBe("$999");
  });
});

// --- formatTicketRange -------------------------------------------------------
describe("formatTicketRange", () => {
  it("returns — when both min and max are null", () => {
    expect(formatTicketRange(null, null)).toBe("—");
  });

  it("shows range when both min and max are given", () => {
    expect(formatTicketRange(1_000_000, 5_000_000)).toBe("$1M – $5M");
  });

  it("shows min+ when only min is given", () => {
    expect(formatTicketRange(1_000_000, null)).toBe("$1M+");
  });

  it("shows Up to N when only max is given", () => {
    expect(formatTicketRange(null, 5_000_000)).toBe("Up to $5M");
  });
});

// --- fitScoreColor -----------------------------------------------------------
describe("fitScoreColor", () => {
  it("returns emerald style for score >= 80", () => {
    expect(fitScoreColor(80)).toContain("emerald");
    expect(fitScoreColor(100)).toContain("emerald");
  });

  it("returns yellow style for score >= 60 and < 80", () => {
    expect(fitScoreColor(60)).toContain("yellow");
    expect(fitScoreColor(79)).toContain("yellow");
  });

  it("returns amber style for score >= 40 and < 60", () => {
    expect(fitScoreColor(40)).toContain("amber");
    expect(fitScoreColor(59)).toContain("amber");
  });

  it("returns slate style for score < 40", () => {
    expect(fitScoreColor(0)).toContain("slate");
    expect(fitScoreColor(39)).toContain("slate");
  });
});
