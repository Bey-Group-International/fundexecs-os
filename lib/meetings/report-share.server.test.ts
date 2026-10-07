const ENV = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});
afterAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = ENV;
});

import { REPORT_SHARE_TTL_MS, reportShareUrl, signReportShare, verifyReportShare } from "./report-share.server";

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
