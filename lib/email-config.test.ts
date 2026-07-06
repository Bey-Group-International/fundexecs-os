import { getEmailConfigStatus } from "./email";

describe("getEmailConfigStatus", () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD };
    delete process.env.GMAIL_ACCESS_TOKEN;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });
  afterAll(() => {
    process.env = OLD;
  });

  it("reports none configured and warns when no provider is set", () => {
    const s = getEmailConfigStatus();
    expect(s.willAttemptSend).toBe(false);
    expect(s.primaryProvider).toBe("none");
    expect(s.notes.join(" ")).toMatch(/No email provider configured/);
  });

  it("makes Gmail primary but flags token expiry", () => {
    process.env.GMAIL_ACCESS_TOKEN = "tok";
    process.env.RESEND_API_KEY = "key";
    const s = getEmailConfigStatus();
    expect(s.primaryProvider).toBe("gmail");
    expect(s.willAttemptSend).toBe(true);
    expect(s.notes.join(" ")).toMatch(/expires/);
  });

  it("warns when Resend uses the default unverified from-address", () => {
    process.env.RESEND_API_KEY = "key";
    const s = getEmailConfigStatus();
    expect(s.primaryProvider).toBe("resend");
    expect(s.usingDefaultFrom).toBe(true);
    expect(s.fromDomain).toBe("fundexecs.com");
    expect(s.notes.join(" ")).toMatch(/must be verified in Resend/);
  });

  it("surfaces the configured from-domain to verify", () => {
    process.env.RESEND_API_KEY = "key";
    process.env.RESEND_FROM_EMAIL = "meetings@acme.vc";
    const s = getEmailConfigStatus();
    expect(s.usingDefaultFrom).toBe(false);
    expect(s.fromDomain).toBe("acme.vc");
    expect(s.notes.join(" ")).toMatch(/acme\.vc/);
  });
});
