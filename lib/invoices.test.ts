import {
  lineItemSubtotalCents,
  invoiceTotalCents,
  formatMoney,
  isPayable,
  nextInvoiceNumber,
  validateInvoiceDraft,
  MIN_INVOICE_CENTS,
  type InvoiceDraft,
} from "@/lib/invoices";

describe("line item + total math", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineItemSubtotalCents({ description: "x", quantity: 3, unitAmountCents: 250 })).toBe(750);
  });

  it("clamps negative or fractional inputs so a charge is never negative", () => {
    expect(lineItemSubtotalCents({ description: "x", quantity: -2, unitAmountCents: 500 })).toBe(0);
    expect(lineItemSubtotalCents({ description: "x", quantity: 2.9, unitAmountCents: 100.7 })).toBe(200);
  });

  it("sums line items into a total", () => {
    expect(
      invoiceTotalCents([
        { description: "a", quantity: 2, unitAmountCents: 1000 },
        { description: "b", quantity: 1, unitAmountCents: 500 },
      ]),
    ).toBe(2500);
    expect(invoiceTotalCents([])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("renders minor units as currency", () => {
    expect(formatMoney(2500)).toBe("$25.00");
    expect(formatMoney(50)).toBe("$0.50");
  });
  it("honors a non-USD currency code", () => {
    expect(formatMoney(1000, "eur")).toContain("10.00");
  });
});

describe("isPayable", () => {
  it("only open invoices are payable", () => {
    expect(isPayable("open")).toBe(true);
    expect(isPayable("paid")).toBe(false);
    expect(isPayable("draft")).toBe(false);
    expect(isPayable("void")).toBe(false);
  });
});

describe("nextInvoiceNumber", () => {
  it("starts at INV-0001 with no prior", () => {
    expect(nextInvoiceNumber(null)).toBe("INV-0001");
    expect(nextInvoiceNumber(undefined)).toBe("INV-0001");
  });
  it("increments and zero-pads the numeric part", () => {
    expect(nextInvoiceNumber("INV-0007")).toBe("INV-0008");
    expect(nextInvoiceNumber("INV-0099")).toBe("INV-0100");
  });
  it("tolerates an oddly-formatted previous value", () => {
    expect(nextInvoiceNumber("garbage")).toBe("INV-0001");
    expect(nextInvoiceNumber("2024/42")).toBe("INV-202443");
  });
});

describe("validateInvoiceDraft", () => {
  const base: InvoiceDraft = {
    title: "Consulting",
    lineItems: [{ description: "Advisory", quantity: 2, unitAmountCents: 5000 }],
  };

  it("accepts a well-formed draft and returns the derived total", () => {
    const v = validateInvoiceDraft(base);
    expect(v).toEqual({
      ok: true,
      items: [{ description: "Advisory", quantity: 2, unitAmountCents: 5000 }],
      totalCents: 10000,
    });
  });

  it("requires a title", () => {
    expect(validateInvoiceDraft({ ...base, title: "  " })).toEqual({
      ok: false,
      error: "Add an invoice title.",
    });
  });

  it("rejects a malformed email", () => {
    const v = validateInvoiceDraft({ ...base, customerEmail: "not-an-email" });
    expect(v.ok).toBe(false);
  });

  it("drops blank rows but requires at least one real item", () => {
    const v = validateInvoiceDraft({
      ...base,
      lineItems: [{ description: "  ", quantity: 1, unitAmountCents: 100 }],
    });
    expect(v).toEqual({ ok: false, error: "Add at least one line item." });
  });

  it("rejects a non-positive quantity", () => {
    const v = validateInvoiceDraft({
      ...base,
      lineItems: [{ description: "Advisory", quantity: 0, unitAmountCents: 5000 }],
    });
    expect(v.ok).toBe(false);
  });

  it("enforces the Stripe minimum charge", () => {
    const v = validateInvoiceDraft({
      title: "Tiny",
      lineItems: [{ description: "cent", quantity: 1, unitAmountCents: MIN_INVOICE_CENTS - 1 }],
    });
    expect(v.ok).toBe(false);
  });
});
