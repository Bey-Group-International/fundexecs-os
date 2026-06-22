// lib/contracts.test.ts
import {
  CONTRACT_STATUS_META,
  DOCUMENT_TYPE_LABELS,
  daysUntilExpiry,
  renewalUrgency,
  type ContractStatus,
} from "@/lib/contracts";

// --- CONTRACT_STATUS_META ----------------------------------------------------
describe("CONTRACT_STATUS_META", () => {
  it("draft advances to review", () => {
    expect(CONTRACT_STATUS_META.draft.next).toBe("review");
    expect(CONTRACT_STATUS_META.draft.nextLabel).toBeTruthy();
  });

  it("terminal statuses (active, expired, terminated) have no next", () => {
    expect(CONTRACT_STATUS_META.active.next).toBeNull();
    expect(CONTRACT_STATUS_META.expired.next).toBeNull();
    expect(CONTRACT_STATUS_META.terminated.next).toBeNull();
  });

  it("all statuses have a label and color", () => {
    const statuses: ContractStatus[] = ["draft", "review", "sent", "signed", "active", "expired", "terminated"];
    for (const s of statuses) {
      expect(CONTRACT_STATUS_META[s].label).toBeTruthy();
      expect(CONTRACT_STATUS_META[s].color).toBeTruthy();
    }
  });

  it("workflow chain: draft → review → sent → signed → active", () => {
    expect(CONTRACT_STATUS_META.draft.next).toBe("review");
    expect(CONTRACT_STATUS_META.review.next).toBe("sent");
    expect(CONTRACT_STATUS_META.sent.next).toBe("signed");
    expect(CONTRACT_STATUS_META.signed.next).toBe("active");
  });
});

// --- DOCUMENT_TYPE_LABELS ----------------------------------------------------
describe("DOCUMENT_TYPE_LABELS", () => {
  it("has a human-readable label for every doc type", () => {
    expect(DOCUMENT_TYPE_LABELS.lpa).toBe("Limited Partnership Agreement");
    expect(DOCUMENT_TYPE_LABELS.nda).toBe("Non-Disclosure Agreement");
    expect(DOCUMENT_TYPE_LABELS.other).toBe("Other");
  });
});

// --- daysUntilExpiry ---------------------------------------------------------
describe("daysUntilExpiry", () => {
  it("returns null when expiryDate is null", () => {
    expect(daysUntilExpiry(null)).toBeNull();
  });

  it("returns a negative number for past expiry dates", () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(daysUntilExpiry(past)).toBeLessThan(0);
  });

  it("returns a positive number for future expiry dates", () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    const days = daysUntilExpiry(future);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(10);
  });

  it("returns 0 or negative for a date that is exactly now (within ceiling rounding)", () => {
    // Expiry exactly at now — Math.ceil of near-zero ms means 0 or 1
    const now = new Date(Date.now() + 500).toISOString(); // 0.5 seconds ahead
    const days = daysUntilExpiry(now);
    expect(days).toBeLessThanOrEqual(1);
  });
});

// --- renewalUrgency ----------------------------------------------------------
describe("renewalUrgency", () => {
  it("returns null when days is null", () => {
    expect(renewalUrgency(null)).toBeNull();
  });

  it("returns expired for 0 days", () => {
    expect(renewalUrgency(0)).toBe("expired");
  });

  it("returns expired for negative days", () => {
    expect(renewalUrgency(-5)).toBe("expired");
  });

  it("returns critical for 1-14 days", () => {
    expect(renewalUrgency(1)).toBe("critical");
    expect(renewalUrgency(14)).toBe("critical");
  });

  it("returns soon for 15-30 days", () => {
    expect(renewalUrgency(15)).toBe("soon");
    expect(renewalUrgency(30)).toBe("soon");
  });

  it("returns ok for 31+ days", () => {
    expect(renewalUrgency(31)).toBe("ok");
    expect(renewalUrgency(365)).toBe("ok");
  });
});
