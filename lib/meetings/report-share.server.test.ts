const ENV = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});
afterAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = ENV;
});

import {
  REPORT_SHARE_TTL_MS,
  guestReportShareUrl,
  guestSubject,
  reportShareUrl,
  signGuestReportShare,
  signReportShare,
  verifyReportShare,
} from "./report-share.server";

const NOW = Date.UTC(2026, 9, 6);

describe("report share links", () => {
  it("round-trips the meeting and recipient until it expires", () => {
    const token = signReportShare("abc-def", "Ana@Acme.com", NOW)!;
    expect(verifyReportShare(token, NOW + 1000)).toEqual({ r: "abc-def", e: "ana@acme.com", x: NOW + REPORT_SHARE_TTL_MS });
    expect(verifyReportShare(token, NOW + REPORT_SHARE_TTL_MS + 1)).toBeNull();
  });

  it("rejects a tampered token, a foreign signature and garbage", () => {
    const token = signReportShare("abc-def", "ana@acme.com", NOW)!;
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ r: "other-room", e: "ana@acme.com", x: NOW + 1e12 })).toString("base64url");
    expect(verifyReportShare(`${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyReportShare(`${body}.${sig.slice(0, -2)}xx`, NOW)).toBeNull();
    expect(verifyReportShare("nonsense", NOW)).toBeNull();
    expect(verifyReportShare("", NOW)).toBeNull();
  });

  it("cannot sign without the key, so the caller falls back to the in-app link", () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(signReportShare("abc", "ana@acme.com", NOW)).toBeNull();
    expect(reportShareUrl("abc", "ana@acme.com", NOW)).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  });

  it("builds a link under /r/report/", () => {
    expect(reportShareUrl("abc-def", "ana@acme.com", NOW)).toMatch(/\/r\/report\/[\w-]+\.[\w-]+$/);
  });
});

describe("a guest's link", () => {
  // The guest key is also what admits them to the room, and a link is
  // forwarded far more casually than a browser's storage. The token names
  // the guest by a digest the key cannot be recovered from.
  it("round-trips the meeting and a digest of the key, never the key", () => {
    const token = signGuestReportShare("abc-def", "guest-key-77", NOW)!;
    expect(verifyReportShare(token, NOW + 1000)).toEqual({ r: "abc-def", g: guestSubject("guest-key-77"), x: NOW + REPORT_SHARE_TTL_MS });
    expect(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).not.toContain("guest-key-77");
    expect(verifyReportShare(token, NOW + REPORT_SHARE_TTL_MS + 1)).toBeNull();
  });

  it("is a different token from an emailed one and cannot be forged into it", () => {
    const guest = signGuestReportShare("abc-def", "guest-key-77", NOW)!;
    const [, sig] = guest.split(".");
    const both = Buffer.from(JSON.stringify({ r: "abc-def", g: "x", e: "ana@acme.com", x: NOW + 1e12 })).toString("base64url");
    const neither = Buffer.from(JSON.stringify({ r: "abc-def", x: NOW + 1e12 })).toString("base64url");
    expect(verifyReportShare(`${both}.${sig}`, NOW)).toBeNull();
    expect(verifyReportShare(`${neither}.${sig}`, NOW)).toBeNull();
  });

  it("refuses to sign for a blank key, and builds a link under /r/report/", () => {
    expect(signGuestReportShare("abc-def", "   ", NOW)).toBeNull();
    expect(guestReportShareUrl("abc-def", "guest-key-77", NOW)).toMatch(/\/r\/report\/[\w-]+\.[\w-]+$/);
  });
});
