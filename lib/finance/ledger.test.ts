import {
  round4,
  assertBalanced,
  normalizeLines,
  computeTrialBalance,
  postingAction,
  reversalLines,
  entryHash,
} from "./ledger";

describe("round4", () => {
  it("rounds to 4dp without float drift", () => {
    expect(round4(0.1 + 0.2)).toBe(0.3);
    expect(round4(42500.12345)).toBe(42500.1235);
  });
});

describe("normalizeLines", () => {
  it("assigns line numbers and derives base amount from fx rate", () => {
    const lines = normalizeLines([
      { accountId: "a", amount: 100, currency: "EUR", fxRate: 1.1 },
      { accountId: "b", amount: -100, currency: "EUR", fxRate: 1.1 },
    ]);
    expect(lines[0]).toMatchObject({ lineNo: 1, baseAmount: 110 });
    expect(lines[1]).toMatchObject({ lineNo: 2, baseAmount: -110 });
  });

  it("prefers an explicit baseAmount over the fx-derived one", () => {
    const [l] = normalizeLines([{ accountId: "a", amount: 100, currency: "EUR", fxRate: 1.1, baseAmount: 111 }]);
    expect(l.baseAmount).toBe(111);
  });
});

describe("assertBalanced", () => {
  it("accepts a two-sided entry that nets to zero", () => {
    const r = assertBalanced([{ baseAmount: 42500 }, { baseAmount: -42500 }]);
    expect(r).toEqual({ balanced: true, imbalance: 0, lineCount: 2 });
  });

  it("rejects an unbalanced entry and reports the imbalance", () => {
    const r = assertBalanced([{ baseAmount: 42500 }, { baseAmount: -42000 }]);
    expect(r.balanced).toBe(false);
    expect(r.imbalance).toBe(500);
  });

  it("rejects a single-line entry even when it is zero", () => {
    expect(assertBalanced([{ baseAmount: 0 }]).balanced).toBe(false);
  });

  it("tolerates sub-cent float drift via 4dp rounding", () => {
    expect(assertBalanced([{ baseAmount: 0.1 }, { baseAmount: 0.2 }, { baseAmount: -0.3 }]).balanced).toBe(true);
  });
});

describe("computeTrialBalance", () => {
  it("nets base amounts per account", () => {
    const tb = computeTrialBalance([
      { accountId: "cash", baseAmount: 100 },
      { accountId: "cash", baseAmount: -30 },
      { accountId: "rev", baseAmount: -70 },
    ]);
    expect(tb.get("cash")).toBe(70);
    expect(tb.get("rev")).toBe(-70);
    // A balanced ledger's trial balance sums to zero.
    expect([...tb.values()].reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe("postingAction", () => {
  it("is Tier-1 post into an open period, Tier-3 into a closed/locked one", () => {
    expect(postingAction("open")).toBe("post_journal_entry");
    expect(postingAction("closed")).toBe("post_to_closed_period");
    expect(postingAction("locked")).toBe("post_to_closed_period");
  });
});

describe("reversalLines", () => {
  it("flips every sign so the reversal nets against the original", () => {
    const original = normalizeLines([
      { accountId: "ar", amount: 42500, currency: "USD" },
      { accountId: "rev", amount: -42500, currency: "USD" },
    ]);
    const rev = normalizeLines(reversalLines(original));
    expect(assertBalanced(rev).balanced).toBe(true);
    const combined = computeTrialBalance([...original, ...rev]);
    // Original + reversal cancels to zero on every account.
    expect([...combined.values()].every((v) => v === 0)).toBe(true);
  });
});

describe("entryHash", () => {
  it("is deterministic and chains to the prior hash", () => {
    const lines = normalizeLines([
      { accountId: "a", amount: 100, currency: "USD" },
      { accountId: "b", amount: -100, currency: "USD" },
    ]);
    const p = { ledgerId: "L1", entryNo: 1, entryDate: "2026-07-31", lines };
    const h1 = entryHash(null, p);
    expect(entryHash(null, p)).toBe(h1); // deterministic
    expect(entryHash(h1, { ...p, entryNo: 2 })).not.toBe(h1); // chained + varies
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
