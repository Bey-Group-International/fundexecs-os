// lib/integrations/adapters/gmail.test.ts
// The gmail adapter's live gate with per-org vault credentials: an org whose
// own Gmail/Resend credential resolved into ctx.secrets sends live even on a
// deploy with no env credentials, and those credentials are handed through to
// the unified sender.
const sendEmail = jest.fn();
jest.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  escapeHtml: (s: string) => s,
}));

const getGoogleAccessToken = jest.fn();
jest.mock("@/lib/google-oauth", () => ({
  getGoogleAccessToken: (...a: unknown[]) => getGoogleAccessToken(...a),
}));

import { gmailAdapter } from "./gmail";
import type { ActionKind } from "@/lib/gates";
import type { DispatchContext } from "../types";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GMAIL_ACCESS_TOKEN;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.RESEND_API_KEY;
  sendEmail.mockResolvedValue({ ok: true, channel: "resend", detail: "sent" });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const ctx = (overrides: Partial<DispatchContext> = {}): DispatchContext => ({
  orgId: "org-1",
  actorId: "user-1",
  action: "send_outreach" as ActionKind,
  target: { name: "Acme LP", email: "lp@acme.test" },
  subject: "Intro",
  body: "Hello",
  ...overrides,
});

describe("gmail adapter per-org credential gate", () => {
  it("drafts (does not send) with no env creds, no org creds, and no connection", async () => {
    const result = await gmailAdapter.dispatch(ctx({ secrets: {} }));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends live on a credential-less deploy when the org's own vault key resolved", async () => {
    const result = await gmailAdapter.dispatch(ctx({ secrets: { RESEND_API_KEY: "re_org" } }));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("hands the org's credentials through to the unified sender", async () => {
    await gmailAdapter.dispatch(
      ctx({
        connected: true,
        secrets: {
          GMAIL_ACCESS_TOKEN: "org-gmail",
          RESEND_API_KEY: "re_org",
          RESEND_FROM_EMAIL: "gp@fund.test",
        },
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          gmailAccessToken: "org-gmail",
          resendApiKey: "re_org",
          fromEmail: "gp@fund.test",
        },
      }),
    );
  });

  it("mints a live token from the vaulted refresh token and hands it to the sender", async () => {
    getGoogleAccessToken.mockResolvedValue("minted-at");
    await gmailAdapter.dispatch(
      ctx({ connected: true, secrets: { GOOGLE_REFRESH_TOKEN: "rt-org" } }),
    );
    // The already-resolved refresh token is passed in — no second vault read.
    expect(getGoogleAccessToken).toHaveBeenCalledWith("org-1", "rt-org");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ gmailAccessToken: "minted-at" }),
      }),
    );
  });

  it("a static GMAIL_ACCESS_TOKEN wins over minting from the refresh token", async () => {
    await gmailAdapter.dispatch(
      ctx({
        connected: true,
        secrets: { GMAIL_ACCESS_TOKEN: "static-at", GOOGLE_REFRESH_TOKEN: "rt-org" },
      }),
    );
    expect(getGoogleAccessToken).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ gmailAccessToken: "static-at" }),
      }),
    );
  });

  it("still attempts the send with no gmail token when minting fails (Resend leg)", async () => {
    getGoogleAccessToken.mockResolvedValue(null);
    const result = await gmailAdapter.dispatch(
      ctx({
        connected: true,
        secrets: { GOOGLE_REFRESH_TOKEN: "rt-org", RESEND_API_KEY: "re_org" },
      }),
    );
    expect(result.live).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          gmailAccessToken: undefined,
          resendApiKey: "re_org",
        }),
      }),
    );
  });

  it("an explicit connected:false still drafts even when org creds resolved", async () => {
    const result = await gmailAdapter.dispatch(
      ctx({ connected: false, secrets: { RESEND_API_KEY: "re_org" } }),
    );
    expect(result.live).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
