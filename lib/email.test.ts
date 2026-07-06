// lib/email.test.ts
// The unified sender's per-org credential preference: each provider credential
// prefers the caller's value (resolved from the org vault by the dispatch
// layer) over the deploy-wide env var, so orgs send under their own identity.
import { sendEmail, invoiceReceiptEmail } from "./email";

const ORIGINAL_ENV = process.env;
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GMAIL_ACCESS_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const ARGS = {
  to: { name: "LP", email: "lp@acme.test" },
  subject: "Q2 update",
  htmlBody: "<p>hi</p>",
};

describe("sendEmail per-org credential preference", () => {
  it("reports in-app fallback when no provider resolves anywhere", async () => {
    const result = await sendEmail(ARGS);
    expect(result).toEqual({ ok: false, channel: "in-app", detail: "no email provider configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the org's Gmail token over the env token", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "env-gmail";
    const result = await sendEmail({ ...ARGS, credentials: { gmailAccessToken: "org-gmail" } });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("gmail");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer org-gmail");
  });

  it("sends via Resend with an org key even when no env credential exists", async () => {
    const result = await sendEmail({
      ...ARGS,
      credentials: { resendApiKey: "org-resend", fromEmail: "gp@fund.test" },
    });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("resend");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer org-resend");
    expect(JSON.parse(init.body).from).toContain("gp@fund.test");
  });

  it("falls back from a failing org Gmail send to the org Resend key", async () => {
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce({ ok: false, statusText: "401", text: async () => "expired token" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const result = await sendEmail({
      ...ARGS,
      credentials: { gmailAccessToken: "org-gmail", resendApiKey: "org-resend" },
    });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("resend");
    consoleWarn.mockRestore();
  });
});

describe("invoiceReceiptEmail", () => {
  const RECEIPT_ARGS = {
    merchantName: "Acme Capital",
    invoiceTitle: "Advisory retainer",
    invoiceNumber: "INV-0007",
    amountFormatted: "$25.00",
    paidOn: "Jul 6, 2026",
    lineItems: [
      { description: "Strategy call", quantity: 1, unitFormatted: "$25.00", subtotalFormatted: "$25.00" },
    ],
  };

  it("puts the invoice number and merchant name in the subject", () => {
    const { subject } = invoiceReceiptEmail(RECEIPT_ARGS);
    expect(subject).toContain("INV-0007");
    expect(subject).toContain("Acme Capital");
  });

  it("renders the amount and line-item description in the html", () => {
    const { html } = invoiceReceiptEmail(RECEIPT_ARGS);
    expect(html).toContain("$25.00");
    expect(html).toContain("Strategy call");
  });

  it("HTML-escapes dangerous interpolated values", () => {
    const { html } = invoiceReceiptEmail({ ...RECEIPT_ARGS, merchantName: "<script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
