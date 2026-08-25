// lib/email.test.ts
// The native sender: every message leaves the organization's own Google
// mailbox. These cover how that credential is resolved, and what happens when
// an org has not connected one.
const getOrgSecretMock = jest.fn();
const getGoogleAccessTokenMock = jest.fn();

jest.mock("@/lib/org-secrets", () => ({
  getOrgSecret: (...args: unknown[]) => getOrgSecretMock(...args),
}));

jest.mock("@/lib/google-oauth", () => ({
  getGoogleAccessToken: (...args: unknown[]) => getGoogleAccessTokenMock(...args),
  googleOAuthConfigured: () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
}));

import { sendEmail, invoiceReceiptEmail } from "./email";

const ORIGINAL_ENV = process.env;
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GMAIL_ACCESS_TOKEN;
  delete process.env.FUNDEXECS_FROM_EMAIL;
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  getOrgSecretMock.mockResolvedValue(null);
  getGoogleAccessTokenMock.mockResolvedValue(null);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const ARGS = {
  to: { name: "LP", email: "lp@acme.test" },
  subject: "Q2 update",
  htmlBody: "<p>hi</p>",
};

/** The RFC 2822 message the Gmail call carried, decoded from its base64url raw. */
function sentMessage(): string {
  const body = JSON.parse(fetchMock.mock.calls[0][1].body) as { raw: string };
  return Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
}

describe("sendEmail credential resolution", () => {
  it("reports the in-app fallback when no mailbox is connected", async () => {
    const result = await sendEmail(ARGS);
    expect(result).toEqual({ ok: false, channel: "in-app", detail: "no mailbox connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a token from the org's connected Google account", async () => {
    getGoogleAccessTokenMock.mockResolvedValue("minted-token");
    const result = await sendEmail({ ...ARGS, orgId: "org1" });
    expect(result).toEqual({ ok: true, channel: "gmail", detail: "sent" });
    expect(getGoogleAccessTokenMock).toHaveBeenCalledWith("org1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer minted-token");
  });

  it("prefers a token stored for the org over minting a new one", async () => {
    getOrgSecretMock.mockResolvedValue("stored-token");
    getGoogleAccessTokenMock.mockResolvedValue("minted-token");
    await sendEmail({ ...ARGS, orgId: "org1" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer stored-token");
    expect(getGoogleAccessTokenMock).not.toHaveBeenCalled();
  });

  it("prefers a caller-supplied token over anything it could look up", async () => {
    getOrgSecretMock.mockResolvedValue("stored-token");
    process.env.GMAIL_ACCESS_TOKEN = "env-token";
    await sendEmail({ ...ARGS, orgId: "org1", credentials: { gmailAccessToken: "caller-token" } });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer caller-token");
    expect(getOrgSecretMock).not.toHaveBeenCalled();
  });

  it("falls back to the deploy env token only when the org has none", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "env-token";
    await sendEmail({ ...ARGS, orgId: "org1" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer env-token");
  });

  it("treats a vault failure as an unconnected mailbox, not an error", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    getOrgSecretMock.mockRejectedValue(new Error("vault key missing"));
    const result = await sendEmail({ ...ARGS, orgId: "org1" });
    expect(result.channel).toBe("in-app");
    warn.mockRestore();
  });

  it("does not send anywhere but Gmail", async () => {
    getGoogleAccessTokenMock.mockResolvedValue("tok");
    await sendEmail({ ...ARGS, orgId: "org1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
  });
});

describe("sendEmail message construction", () => {
  beforeEach(() => {
    getGoogleAccessTokenMock.mockResolvedValue("tok");
  });

  it("omits From so Gmail stamps the connected mailbox's own address", async () => {
    await sendEmail({ ...ARGS, orgId: "org1" });
    expect(sentMessage()).not.toContain("From:");
  });

  it("sets From only when an explicit sender is configured", async () => {
    process.env.FUNDEXECS_FROM_EMAIL = "meetings@acme.vc";
    await sendEmail({ ...ARGS, orgId: "org1" });
    expect(sentMessage()).toContain("From: FundExecs <meetings@acme.vc>");
  });

  it("carries the recipient, subject, and html body", async () => {
    await sendEmail({ ...ARGS, orgId: "org1" });
    const msg = sentMessage();
    expect(msg).toContain("To: LP <lp@acme.test>");
    expect(msg).toContain("Subject: Q2 update");
    expect(msg).toContain("<p>hi</p>");
  });
});

describe("sendEmail failure handling", () => {
  it("reports a rejected Gmail send without throwing", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    getGoogleAccessTokenMock.mockResolvedValue("tok");
    fetchMock.mockResolvedValue({ ok: false, statusText: "401", text: async () => "expired token" });
    const result = await sendEmail({ ...ARGS, orgId: "org1" });
    expect(result).toEqual({ ok: false, channel: "gmail", detail: "expired token" });
    warn.mockRestore();
  });

  it("survives a network error instead of throwing at the caller", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    getGoogleAccessTokenMock.mockResolvedValue("tok");
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const result = await sendEmail({ ...ARGS, orgId: "org1" });
    expect(result).toEqual({ ok: false, channel: "gmail", detail: "socket hang up" });
    warn.mockRestore();
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
