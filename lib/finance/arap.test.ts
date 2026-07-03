import {
  computeInvoiceTotals,
  invoiceStatus,
  agingBucket,
  agingSummary,
  allocatePayment,
  type InvoiceLineInput,
  type AgingRow,
  type PayableInvoice,
} from "./arap";

describe("computeInvoiceTotals", () => {
  it("computes a single line with tax", () => {
    const t = computeInvoiceTotals([
      { description: "Consulting", quantity: 10, unitPrice: 100, taxRate: 0.2 },
    ]);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].lineNo).toBe(1);
    expect(t.lines[0].lineSubtotal).toBe(1000);
    expect(t.lines[0].lineTax).toBe(200);
    expect(t.lines[0].lineTotal).toBe(1200);
    expect(t.subtotal).toBe(1000);
    expect(t.tax).toBe(200);
    expect(t.total).toBe(1200);
  });

  it("defaults taxRate to 0 when omitted", () => {
    const t = computeInvoiceTotals([{ description: "Books", quantity: 3, unitPrice: 12.5 }]);
    expect(t.lines[0].taxRate).toBe(0);
    expect(t.lines[0].lineTax).toBe(0);
    expect(t.lines[0].lineTotal).toBe(37.5);
    expect(t.total).toBe(37.5);
  });

  it("sums multiple lines and assigns sequential line numbers", () => {
    const lines: InvoiceLineInput[] = [
      { description: "A", quantity: 2, unitPrice: 50, taxRate: 0.1 },
      { description: "B", quantity: 1, unitPrice: 200 },
      { description: "C", quantity: 5, unitPrice: 10, taxRate: 0.2 },
    ];
    const t = computeInvoiceTotals(lines);
    expect(t.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
    // A: 100 + 10 = 110; B: 200 + 0 = 200; C: 50 + 10 = 60
    expect(t.subtotal).toBe(350);
    expect(t.tax).toBe(20);
    expect(t.total).toBe(370);
    // subtotal + tax === total holds exactly
    expect(t.subtotal + t.tax).toBe(t.total);
  });

  it("rounds per line to 2dp", () => {
    // 3 × 9.99 = 29.97; tax 7.5% = 2.24775 -> 2.25; total 32.22
    const t = computeInvoiceTotals([
      { description: "Widget", quantity: 3, unitPrice: 9.99, taxRate: 0.075 },
    ]);
    expect(t.lines[0].lineSubtotal).toBe(29.97);
    expect(t.lines[0].lineTax).toBe(2.25);
    expect(t.lines[0].lineTotal).toBe(32.22);
  });

  it("handles an empty invoice", () => {
    const t = computeInvoiceTotals([]);
    expect(t.lines).toEqual([]);
    expect(t.subtotal).toBe(0);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(0);
  });
});

describe("invoiceStatus", () => {
  it("is open when nothing is paid", () => {
    expect(invoiceStatus(100, 0)).toBe("open");
  });
  it("is partial when some but not all is paid", () => {
    expect(invoiceStatus(100, 40)).toBe("partial");
    expect(invoiceStatus(100, 99.99)).toBe("partial");
  });
  it("is paid when fully or over paid", () => {
    expect(invoiceStatus(100, 100)).toBe("paid");
    expect(invoiceStatus(100, 150)).toBe("paid");
  });
  it("is open for a zero total (nothing to pay)", () => {
    expect(invoiceStatus(0, 0)).toBe("open");
  });
  it("never returns draft or void", () => {
    const results = [
      invoiceStatus(0, 0),
      invoiceStatus(100, 0),
      invoiceStatus(100, 50),
      invoiceStatus(100, 100),
    ];
    expect(results).not.toContain("draft");
    expect(results).not.toContain("void");
  });
});

describe("agingBucket", () => {
  const due = "2026-04-01";
  it("is current when not yet due (0 days overdue)", () => {
    expect(agingBucket(due, "2026-04-01")).toBe("current");
  });
  it("is current when before the due date", () => {
    expect(agingBucket(due, "2026-03-15")).toBe("current");
  });
  it("buckets by overdue days at the boundaries", () => {
    expect(agingBucket(due, "2026-04-02")).toBe("1-30"); // 1 day
    expect(agingBucket(due, "2026-05-01")).toBe("1-30"); // 30 days
    expect(agingBucket(due, "2026-05-02")).toBe("31-60"); // 31 days
    expect(agingBucket(due, "2026-05-31")).toBe("31-60"); // 60 days
    expect(agingBucket(due, "2026-06-01")).toBe("61-90"); // 61 days
    expect(agingBucket(due, "2026-06-30")).toBe("61-90"); // 90 days
    expect(agingBucket(due, "2026-07-01")).toBe("90+"); // 91 days
  });
});

describe("agingSummary", () => {
  it("rolls outstanding balances into buckets with a grand total", () => {
    const asOf = "2026-07-01";
    const rows: AgingRow[] = [
      { partyId: "p1", dueDate: "2026-07-15", outstanding: 100 }, // current
      { partyId: "p2", dueDate: "2026-06-20", outstanding: 200 }, // 1-30 (11d)
      { partyId: "p3", dueDate: "2026-05-20", outstanding: 50 }, // 31-60 (42d)
      { partyId: "p4", dueDate: "2026-04-15", outstanding: 25 }, // 61-90 (77d)
      { partyId: "p5", dueDate: "2026-01-01", outstanding: 10 }, // 90+
    ];
    const s = agingSummary(rows, asOf);
    expect(s.current).toBe(100);
    expect(s.d1_30).toBe(200);
    expect(s.d31_60).toBe(50);
    expect(s.d61_90).toBe(25);
    expect(s.d90_plus).toBe(10);
    expect(s.total).toBe(385);
  });

  it("sums multiple rows in the same bucket and rounds to 2dp", () => {
    const asOf = "2026-07-01";
    const rows: AgingRow[] = [
      { dueDate: "2026-08-01", outstanding: 10.005 },
      { dueDate: "2026-08-02", outstanding: 20.004 },
    ];
    const s = agingSummary(rows, asOf);
    expect(s.current).toBe(30.01);
    expect(s.total).toBe(30.01);
  });

  it("returns all zeros for no rows", () => {
    const s = agingSummary([], "2026-07-01");
    expect(s).toEqual({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });
  });
});

describe("allocatePayment — oldest-first", () => {
  const invoices: PayableInvoice[] = [
    { id: "inv-c", outstanding: 100, dueDate: "2026-03-01" },
    { id: "inv-a", outstanding: 50, dueDate: "2026-01-01" },
    { id: "inv-b", outstanding: 75, dueDate: "2026-02-01" },
  ];

  it("fills oldest invoices first until exhausted (exact)", () => {
    // 225 == 50 + 75 + 100 exactly
    const r = allocatePayment(225, invoices);
    expect(r.allocations).toEqual([
      { invoiceId: "inv-a", amount: 50 },
      { invoiceId: "inv-b", amount: 75 },
      { invoiceId: "inv-c", amount: 100 },
    ]);
    expect(r.unapplied).toBe(0);
  });

  it("leaves a partial allocation on the last touched invoice", () => {
    // 90 -> inv-a 50, inv-b 40 (partial)
    const r = allocatePayment(90, invoices);
    expect(r.allocations).toEqual([
      { invoiceId: "inv-a", amount: 50 },
      { invoiceId: "inv-b", amount: 40 },
    ]);
    expect(r.unapplied).toBe(0);
  });

  it("returns overpayment as unapplied", () => {
    const r = allocatePayment(300, invoices);
    const applied = r.allocations.reduce((s, a) => s + a.amount, 0);
    expect(applied).toBe(225);
    expect(r.unapplied).toBe(75);
  });

  it("sorts undefined due dates last", () => {
    const withUndated: PayableInvoice[] = [
      { id: "later", outstanding: 40 },
      { id: "early", outstanding: 40, dueDate: "2026-01-01" },
    ];
    const r = allocatePayment(50, withUndated);
    expect(r.allocations[0].invoiceId).toBe("early");
    expect(r.allocations[0].amount).toBe(40);
    expect(r.allocations[1]).toEqual({ invoiceId: "later", amount: 10 });
  });

  it("returns everything unapplied when there are no open invoices", () => {
    const r = allocatePayment(100, [{ id: "x", outstanding: 0 }]);
    expect(r.allocations).toEqual([]);
    expect(r.unapplied).toBe(100);
  });

  it("allocates nothing for a zero payment", () => {
    const r = allocatePayment(0, invoices);
    expect(r.allocations).toEqual([]);
    expect(r.unapplied).toBe(0);
  });
});

describe("allocatePayment — proportional", () => {
  it("splits pro-rata by outstanding and reconciles to the amount", () => {
    const invoices: PayableInvoice[] = [
      { id: "a", outstanding: 100 },
      { id: "b", outstanding: 300 },
    ];
    // 200 split 1:3 -> 50 / 150
    const r = allocatePayment(200, invoices, "proportional");
    expect(r.allocations).toEqual([
      { invoiceId: "a", amount: 50 },
      { invoiceId: "b", amount: 150 },
    ]);
    expect(r.unapplied).toBe(0);
    const sum = r.allocations.reduce((s, a) => s + a.amount, 0);
    expect(sum + r.unapplied).toBe(200);
  });

  it("puts the rounding remainder on the largest allocation", () => {
    const invoices: PayableInvoice[] = [
      { id: "a", outstanding: 100 },
      { id: "b", outstanding: 100 },
      { id: "c", outstanding: 100 },
    ];
    // 100 / 3 = 33.333... each -> 33.33, remainder 0.01 onto the largest.
    const r = allocatePayment(100, invoices, "proportional");
    const sum = r.allocations.reduce((s, a) => s + a.amount, 0);
    expect(sum).toBeCloseTo(100, 2);
    expect(sum + r.unapplied).toBe(100);
    // exactly one allocation carries the extra cent
    const cents = r.allocations.map((a) => a.amount).sort();
    expect(cents).toEqual([33.33, 33.33, 33.34]);
  });

  it("pays every invoice in full and leaves excess unapplied on overpayment", () => {
    const invoices: PayableInvoice[] = [
      { id: "a", outstanding: 100 },
      { id: "b", outstanding: 50 },
    ];
    const r = allocatePayment(200, invoices, "proportional");
    expect(r.allocations).toEqual([
      { invoiceId: "a", amount: 100 },
      { invoiceId: "b", amount: 50 },
    ]);
    expect(r.unapplied).toBe(50);
    const sum = r.allocations.reduce((s, a) => s + a.amount, 0);
    expect(sum + r.unapplied).toBe(200);
  });

  it("never allocates more than an invoice's outstanding", () => {
    const invoices: PayableInvoice[] = [
      { id: "a", outstanding: 10 },
      { id: "b", outstanding: 1000 },
    ];
    const r = allocatePayment(500, invoices, "proportional");
    const a = r.allocations.find((x) => x.invoiceId === "a")!;
    expect(a.amount).toBeLessThanOrEqual(10);
    const sum = r.allocations.reduce((s, x) => s + x.amount, 0);
    expect(sum + r.unapplied).toBe(500);
  });
});
