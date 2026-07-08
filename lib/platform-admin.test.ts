import {
  isPlatformAdminEmail,
  adminAlertRecipients,
} from "@/lib/platform-admin";

describe("isPlatformAdminEmail", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ADMIN_EMAILS;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("accepts the internal domain, case- and whitespace-insensitively", () => {
    expect(isPlatformAdminEmail("ops@beygroupintl.com")).toBe(true);
    expect(isPlatformAdminEmail("  OPS@BeyGroupIntl.COM  ")).toBe(true);
  });

  it("rejects other domains and lookalikes", () => {
    expect(isPlatformAdminEmail("ops@gmail.com")).toBe(false);
    // Not the real domain — must not pass on a suffix/subdomain trick.
    expect(isPlatformAdminEmail("ops@evilbeygroupintl.com")).toBe(false);
    expect(isPlatformAdminEmail("ops@beygroupintl.com.evil.com")).toBe(false);
    expect(isPlatformAdminEmail("beygroupintl.com@gmail.com")).toBe(false);
  });

  it("rejects malformed or empty input", () => {
    expect(isPlatformAdminEmail("")).toBe(false);
    expect(isPlatformAdminEmail(null)).toBe(false);
    expect(isPlatformAdminEmail(undefined)).toBe(false);
    expect(isPlatformAdminEmail("no-at-sign")).toBe(false);
    expect(isPlatformAdminEmail("@beygroupintl.com")).toBe(false);
    expect(isPlatformAdminEmail("ops@")).toBe(false);
  });

  it("honors the ADMIN_EMAILS allowlist", () => {
    process.env.ADMIN_EMAILS = "advisor@partner.io, other@x.com";
    expect(isPlatformAdminEmail("advisor@partner.io")).toBe(true);
    expect(isPlatformAdminEmail("ADVISOR@PARTNER.IO")).toBe(true);
    expect(isPlatformAdminEmail("stranger@partner.io")).toBe(false);
  });
});

describe("adminAlertRecipients", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_ALERT_EMAIL;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("prefers ADMIN_ALERT_EMAIL, splitting and normalizing", () => {
    process.env.ADMIN_ALERT_EMAIL = "A@beygroupintl.com, b@beygroupintl.com";
    expect(adminAlertRecipients()).toEqual([
      "a@beygroupintl.com",
      "b@beygroupintl.com",
    ]);
  });

  it("falls back to ADMIN_EMAILS", () => {
    process.env.ADMIN_EMAILS = "team@beygroupintl.com";
    expect(adminAlertRecipients()).toEqual(["team@beygroupintl.com"]);
  });

  it("returns empty when nothing is configured", () => {
    expect(adminAlertRecipients()).toEqual([]);
  });
});
