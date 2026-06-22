// lib/convertibles.test.ts — pure SAFE / note conversion math, no I/O.
import {
  accruedAmount,
  conversionPrice,
  convert,
  convertAll,
  Instrument,
  PricedRound,
} from "@/lib/convertibles";

const round: PricedRound = {
  pricePerShare: 1.0, // $1.00/share Series A
  preMoneyShares: 10_000_000, // 10M fully-diluted pre-money
};

describe("accruedAmount", () => {
  it("returns principal unchanged for a SAFE (no interest)", () => {
    const safe: Instrument = { name: "SAFE", type: "safe", principal: 500_000 };
    expect(accruedAmount(safe, "2026-06-22")).toBe(500_000);
  });

  it("accrues simple interest on a note over the holding period", () => {
    // 500k @ 6% for exactly one year = 30k interest.
    const note: Instrument = {
      name: "Note",
      type: "note",
      principal: 500_000,
      interestRate: 0.06,
      issueDate: "2025-06-22",
    };
    expect(accruedAmount(note, "2026-06-22")).toBeCloseTo(530_000, 0);
  });

  it("treats a note with no rate or date as principal-only", () => {
    const note: Instrument = { name: "Note", type: "note", principal: 100_000 };
    expect(accruedAmount(note, "2026-06-22")).toBe(100_000);
  });
});

describe("conversionPrice", () => {
  it("uses the discount price when only a discount applies", () => {
    // 20% discount on $1.00 → $0.80
    const safe: Instrument = {
      name: "S",
      type: "safe",
      principal: 100_000,
      discount: 0.2,
    };
    expect(conversionPrice(safe, 1.0, 10_000_000)).toBe(0.8);
  });

  it("uses the cap price when only a cap applies", () => {
    // $5M cap / 10M shares = $0.50
    const safe: Instrument = {
      name: "S",
      type: "safe",
      principal: 100_000,
      valuationCap: 5_000_000,
    };
    expect(conversionPrice(safe, 1.0, 10_000_000)).toBe(0.5);
  });

  it("takes the lower of cap and discount when both apply", () => {
    // discount → $0.80, cap → $0.50; investor gets $0.50.
    const safe: Instrument = {
      name: "S",
      type: "safe",
      principal: 100_000,
      discount: 0.2,
      valuationCap: 5_000_000,
    };
    expect(conversionPrice(safe, 1.0, 10_000_000)).toBe(0.5);
  });

  it("falls back to the round price when neither cap nor discount applies", () => {
    const safe: Instrument = { name: "S", type: "safe", principal: 100_000 };
    expect(conversionPrice(safe, 1.0, 10_000_000)).toBe(1.0);
  });

  it("returns 0 for an unusable round price", () => {
    const safe: Instrument = { name: "S", type: "safe", principal: 100_000 };
    expect(conversionPrice(safe, 0, 10_000_000)).toBe(0);
    expect(conversionPrice(safe, -5, 10_000_000)).toBe(0);
  });
});

describe("convert", () => {
  it("issues shares at the cap price and flags the basis", () => {
    // $1M SAFE, $5M cap → $0.50/share → 2,000,000 shares.
    const safe: Instrument = {
      name: "Angel",
      type: "safe",
      principal: 1_000_000,
      valuationCap: 5_000_000,
      discount: 0.2,
    };
    const r = convert(safe, round, "2026-06-22");
    expect(r.conversionPrice).toBe(0.5);
    expect(r.basis).toBe("cap");
    expect(r.sharesIssued).toBe(2_000_000);
    expect(r.effectiveValuation).toBe(5_000_000);
    expect(r.ownershipPct).toBe(20);
  });

  it("issues shares at the discount price for a discount-only SAFE", () => {
    const safe: Instrument = {
      name: "Seed",
      type: "safe",
      principal: 800_000,
      discount: 0.2,
    };
    const r = convert(safe, round, "2026-06-22");
    expect(r.conversionPrice).toBe(0.8);
    expect(r.basis).toBe("discount");
    expect(r.sharesIssued).toBe(1_000_000); // 800k / 0.80
  });

  it("converts accrued note balance, not just principal", () => {
    // 500k note @ 6% for 1y = 530k accrued; $5M cap → $0.50 → 1,060,000 shares.
    const note: Instrument = {
      name: "Bridge",
      type: "note",
      principal: 500_000,
      interestRate: 0.06,
      issueDate: "2025-06-22",
      valuationCap: 5_000_000,
    };
    const r = convert(note, round, "2026-06-22");
    expect(r.accrued).toBeCloseTo(530_000, 0);
    expect(r.conversionPrice).toBe(0.5);
    expect(r.sharesIssued).toBe(1_060_000);
  });

  it("handles a bare instrument safely (no cap, no discount)", () => {
    const safe: Instrument = { name: "Plain", type: "safe", principal: 250_000 };
    const r = convert(safe, round, "2026-06-22");
    expect(r.conversionPrice).toBe(1.0);
    expect(r.basis).toBe("round");
    expect(r.sharesIssued).toBe(250_000);
  });

  it("returns zero shares for a zero-priced / empty round", () => {
    const safe: Instrument = {
      name: "S",
      type: "safe",
      principal: 100_000,
      valuationCap: 5_000_000,
    };
    const r = convert(safe, { pricePerShare: 0, preMoneyShares: 0 }, "2026-06-22");
    expect(r.sharesIssued).toBe(0);
    expect(r.ownershipPct).toBe(0);
  });
});

describe("convertAll", () => {
  it("converts a batch and totals invested / accrued / shares", () => {
    const instruments: Instrument[] = [
      {
        name: "Angel",
        type: "safe",
        principal: 1_000_000,
        valuationCap: 5_000_000,
      },
      { name: "Seed", type: "safe", principal: 800_000, discount: 0.2 },
    ];
    const out = convertAll(instruments, round, "2026-06-22");
    expect(out.results).toHaveLength(2);
    expect(out.totalInvested).toBe(1_800_000);
    expect(out.totalAccrued).toBe(1_800_000);
    // 2,000,000 (cap) + 1,000,000 (discount) = 3,000,000
    expect(out.totalSharesIssued).toBe(3_000_000);
  });

  it("handles an empty instrument list", () => {
    const out = convertAll([], round, "2026-06-22");
    expect(out.totalSharesIssued).toBe(0);
    expect(out.totalInvested).toBe(0);
  });
});
