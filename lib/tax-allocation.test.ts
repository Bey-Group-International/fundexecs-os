// lib/tax-allocation.test.ts — pure K-1 allocation math, no I/O.
import {
  allocateTaxYear,
  netTaxableOf,
  splitByShare,
  type TaxHolder,
  type TaxItems,
} from "@/lib/tax-allocation";

const holders: TaxHolder[] = [
  { investorId: "a", name: "A", ownershipPct: 60, beginningCapital: 600_000, contributions: 100_000, distributions: 50_000 },
  { investorId: "b", name: "B", ownershipPct: 40, beginningCapital: 400_000, contributions: 0, distributions: 0 },
];

const items: TaxItems = {
  ordinaryIncome: 100_000,
  interest: 0,
  dividends: 0,
  shortTermGain: 0,
  longTermGain: 50_000,
  expenses: 30_000,
};

describe("netTaxableOf", () => {
  it("nets income items against expenses", () => {
    expect(netTaxableOf(items)).toBe(120_000); // 100k + 50k − 30k
  });
});

describe("splitByShare", () => {
  it("splits proportionally and ties out to the total", () => {
    const out = splitByShare(100, [60, 40]);
    expect(out).toEqual([60, 40]);
    expect(out.reduce((s, x) => s + x, 0)).toBe(100);
  });

  it("trues up rounding residual on the largest share", () => {
    const out = splitByShare(100, [1, 1, 1]);
    expect(out.reduce((s, x) => s + x, 0)).toBe(100); // no cents lost
  });

  it("returns zeros when shares sum to zero", () => {
    expect(splitByShare(100, [0, 0])).toEqual([0, 0]);
  });
});

describe("allocateTaxYear", () => {
  const result = allocateTaxYear(2026, items, holders);

  it("allocates each line item by ownership share", () => {
    const a = result.allocations.find((x) => x.investorId === "a")!;
    expect(a.ordinaryIncome).toBe(60_000);
    expect(a.longTermGain).toBe(30_000);
    expect(a.expenses).toBe(18_000);
    expect(a.netAllocated).toBe(72_000); // 60k + 30k − 18k
  });

  it("rolls the capital account forward", () => {
    const a = result.allocations.find((x) => x.investorId === "a")!;
    // 600k begin + 100k contrib − 50k dist + 72k allocated
    expect(a.endingCapital).toBe(722_000);
  });

  it("ties per-LP lines back to the fund totals", () => {
    const sumOrdinary = result.allocations.reduce((s, x) => s + x.ordinaryIncome, 0);
    expect(sumOrdinary).toBe(items.ordinaryIncome);
    const sumNet = result.allocations.reduce((s, x) => s + x.netAllocated, 0);
    expect(sumNet).toBe(result.netTaxable);
  });
});
