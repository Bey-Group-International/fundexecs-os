import {
  NET_TERMS_DAYS,
  awaitingApplication,
  daysUntilDue,
  dueDate,
  invoiceHealth,
  invoiceSummary,
  isOverdue,
  paymentReferenceFor,
  remittanceConfigured,
  remittanceDetails,
  type SubscriptionInvoice,
} from "@/lib/subscription-invoices";

function invoice(overrides: Partial<SubscriptionInvoice> = {}): SubscriptionInvoice {
  return {
    id: "inv_1",
    organization_id: "org_1",
    subscription_id: "sub_1",
    number: "FX-202609-00001",
    plan: "pro",
    interval: "monthly",
    period_start: "2026-09-01T00:00:00.000Z",
    period_end: "2026-10-01T00:00:00.000Z",
    amount_usd: 30,
    credits: 4000,
    status: "open",
    issued_at: "2026-09-01T00:00:00.000Z",
    due_at: "2026-09-15T00:00:00.000Z",
    paid_at: null,
    paid_via: null,
    payment_reference: null,
    applied_at: null,
    settlement_intent: null,
    settlement_started_at: null,
    settlement_failure: null,
    settlement_attempts: 0,
    note: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const REMITTANCE_VARS = [
  "FUNDEXECS_REMITTANCE_BANK_NAME",
  "FUNDEXECS_REMITTANCE_ACCOUNT_NAME",
  "FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER",
  "FUNDEXECS_REMITTANCE_ROUTING",
  "FUNDEXECS_REMITTANCE_SWIFT",
  "FUNDEXECS_REMITTANCE_NOTES",
];
beforeEach(() => {
  for (const v of REMITTANCE_VARS) delete process.env[v];
});

describe("terms", () => {
  it("falls due a fortnight after issue", () => {
    expect(dueDate(new Date("2026-09-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(NET_TERMS_DAYS).toBe(14);
  });

  it("honours a custom terms length", () => {
    expect(dueDate(new Date("2026-09-01T00:00:00Z"), 30).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("is overdue only once the due date has passed, and only while open", () => {
    expect(isOverdue(invoice(), new Date("2026-09-14T00:00:00Z"))).toBe(false);
    expect(isOverdue(invoice(), new Date("2026-09-15T00:00:00Z"))).toBe(true);
    // A settled invoice is never "overdue", whatever the calendar says.
    expect(isOverdue(invoice({ status: "paid" }), new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("counts days to the due date, going negative once late", () => {
    expect(daysUntilDue(invoice(), new Date("2026-09-10T00:00:00Z"))).toBe(5);
    expect(daysUntilDue(invoice(), new Date("2026-09-18T00:00:00Z"))).toBe(-3);
  });
});

describe("application", () => {
  it("owes its period only when settled and not yet applied", () => {
    expect(awaitingApplication(invoice())).toBe(false);
    expect(awaitingApplication(invoice({ status: "paid" }))).toBe(true);
    expect(
      awaitingApplication(invoice({ status: "paid", applied_at: "2026-09-10T00:00:00Z" })),
    ).toBe(false);
  });
});

describe("remittance configuration", () => {
  it("is unconfigured by default, which hands settlement to the card fallback", () => {
    expect(remittanceDetails()).toBeNull();
    expect(remittanceConfigured()).toBe(false);
  });

  it("needs a bank, a payee AND an account before it will show instructions", () => {
    // Half-filled instructions are worse than none: an operator cannot send
    // money with them, so they must not count as a native path.
    process.env.FUNDEXECS_REMITTANCE_BANK_NAME = "First Bank";
    expect(remittanceConfigured()).toBe(false);
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NAME = "FundExecs LLC";
    expect(remittanceConfigured()).toBe(false);
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER = "123456789";
    expect(remittanceConfigured()).toBe(true);
  });

  it("carries the optional rails through when set", () => {
    process.env.FUNDEXECS_REMITTANCE_BANK_NAME = "First Bank";
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NAME = "FundExecs LLC";
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER = "123456789";
    process.env.FUNDEXECS_REMITTANCE_SWIFT = "FIRSTUS33";
    expect(remittanceDetails()).toMatchObject({ swift: "FIRSTUS33", routingNumber: "" });
  });

  it("ignores whitespace pasted into an env UI", () => {
    process.env.FUNDEXECS_REMITTANCE_BANK_NAME = "  ";
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NAME = "FundExecs LLC";
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER = "123456789";
    expect(remittanceConfigured()).toBe(false);
  });
});

describe("display", () => {
  it("grades an invoice by how close it is to trouble", () => {
    expect(invoiceHealth(invoice(), new Date("2026-09-02T00:00:00Z"))).toBe("due");
    expect(invoiceHealth(invoice(), new Date("2026-09-13T00:00:00Z"))).toBe("due_soon");
    expect(invoiceHealth(invoice(), new Date("2026-09-16T00:00:00Z"))).toBe("overdue");
    expect(invoiceHealth(invoice({ status: "paid" }))).toBe("settled");
    expect(invoiceHealth(invoice({ status: "written_off" }))).toBe("closed");
  });

  it("says what is owed and by when", () => {
    expect(invoiceSummary(invoice(), new Date("2026-09-10T00:00:00Z"))).toMatch(/due in 5 day/);
    expect(invoiceSummary(invoice(), new Date("2026-09-18T00:00:00Z"))).toMatch(/3 day\(s\) overdue/);
    expect(invoiceSummary(invoice({ status: "paid" }))).toMatch(/received/);
  });

  it("uses the invoice number as the transfer reference", () => {
    // This is how a wire gets matched back to a period — it must be the number
    // shown on the bill, not a derived string.
    expect(paymentReferenceFor(invoice())).toBe("FX-202609-00001");
  });
});
