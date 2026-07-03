import { invoiceJournalLines, paymentJournalLines, isBalanced } from "./posting";

const sum = (lines: { amount: number }[]) =>
  Math.round(lines.reduce((s, l) => s + l.amount, 0) * 1e4) / 1e4;

describe("invoiceJournalLines", () => {
  it("posts a receivable: Dr AR control, Cr revenue + tax, balanced", () => {
    const lines = invoiceJournalLines(
      "receivable",
      "USD",
      [
        { incomeAccountId: "rev", lineSubtotal: 100, lineTax: 20 },
        { incomeAccountId: "rev", lineSubtotal: 50, lineTax: 10 },
      ],
      { controlAccountId: "ar", taxAccountId: "tax" },
    );
    // Control (Dr +180), revenue combined (Cr -150), tax (Cr -30).
    const control = lines.find((l) => l.accountId === "ar")!;
    const revenue = lines.find((l) => l.accountId === "rev")!;
    const tax = lines.find((l) => l.accountId === "tax")!;
    expect(control.amount).toBe(180);
    expect(revenue.amount).toBe(-150);
    expect(tax.amount).toBe(-30);
    expect(sum(lines)).toBe(0);
    expect(isBalanced(lines)).toBe(true);
  });

  it("posts a payable with flipped signs (Dr expense + tax, Cr AP control)", () => {
    const lines = invoiceJournalLines(
      "payable",
      "USD",
      [{ incomeAccountId: "exp", lineSubtotal: 200, lineTax: 0 }],
      { controlAccountId: "ap" },
    );
    expect(lines.find((l) => l.accountId === "exp")!.amount).toBe(200);
    expect(lines.find((l) => l.accountId === "ap")!.amount).toBe(-200);
    expect(sum(lines)).toBe(0);
  });

  it("combines multiple lines that share an income account", () => {
    const lines = invoiceJournalLines(
      "receivable",
      "USD",
      [
        { incomeAccountId: "rev", lineSubtotal: 100, lineTax: 0 },
        { incomeAccountId: "rev", lineSubtotal: 25, lineTax: 0 },
      ],
      { controlAccountId: "ar" },
    );
    // One combined revenue line, not two.
    expect(lines.filter((l) => l.accountId === "rev")).toHaveLength(1);
    expect(lines.find((l) => l.accountId === "rev")!.amount).toBe(-125);
  });

  it("falls back to the default line account when a line has none", () => {
    const lines = invoiceJournalLines(
      "receivable",
      "USD",
      [{ lineSubtotal: 40, lineTax: 0 }],
      { controlAccountId: "ar", defaultLineAccountId: "rev-default" },
    );
    expect(lines.find((l) => l.accountId === "rev-default")!.amount).toBe(-40);
  });

  it("throws when a line has no account and no default", () => {
    expect(() =>
      invoiceJournalLines("receivable", "USD", [{ lineSubtotal: 10, lineTax: 0 }], {
        controlAccountId: "ar",
      }),
    ).toThrow(/no income account/);
  });

  it("throws when there is tax but no tax account", () => {
    expect(() =>
      invoiceJournalLines("receivable", "USD", [{ incomeAccountId: "rev", lineSubtotal: 10, lineTax: 2 }], {
        controlAccountId: "ar",
      }),
    ).toThrow(/tax account/);
  });
});

describe("paymentJournalLines", () => {
  it("inbound: Dr cash, Cr AR control", () => {
    const lines = paymentJournalLines("inbound", "USD", 250, "ar", "cash");
    expect(lines.find((l) => l.accountId === "cash")!.amount).toBe(250);
    expect(lines.find((l) => l.accountId === "ar")!.amount).toBe(-250);
    expect(sum(lines)).toBe(0);
  });

  it("outbound: Dr AP control, Cr cash", () => {
    const lines = paymentJournalLines("outbound", "USD", 90, "ap", "cash");
    expect(lines.find((l) => l.accountId === "ap")!.amount).toBe(90);
    expect(lines.find((l) => l.accountId === "cash")!.amount).toBe(-90);
    expect(sum(lines)).toBe(0);
  });

  it("throws on a non-positive amount", () => {
    expect(() => paymentJournalLines("inbound", "USD", 0, "ar", "cash")).toThrow(/positive/);
  });
});
