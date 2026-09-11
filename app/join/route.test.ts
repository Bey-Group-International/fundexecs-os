// Coverage for the referral link's cookie hop. Two things matter here: the code
// always reaches the 30-day cookie that onboarding later claims, and `next`
// never turns this into an open redirect — anyone can craft a /join link and
// forward it, so an unvetted `next` would hand out redirects under our domain.

import { NextRequest } from "next/server";
import { GET } from "./route";

function req(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

function location(res: Response): string {
  return new URL(res.headers.get("location") ?? "", "http://localhost").pathname;
}

describe("GET /join", () => {
  it("sends a bare invite link on to its invite page, carrying the cookie", async () => {
    const res = await GET(req("/join?ref=K7M2QX4P"));

    expect(location(res)).toBe("/join/K7M2QX4P");
    const cookie = res.cookies.get("referral_code");
    expect(cookie?.value).toBe("K7M2QX4P");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("upper-cases and trims the code, so a retyped link still resolves", async () => {
    const res = await GET(req("/join?ref=%20k7m2qx4p%20"));

    expect(res.cookies.get("referral_code")?.value).toBe("K7M2QX4P");
    expect(location(res)).toBe("/join/K7M2QX4P");
  });

  it("forwards to the allowed destinations the invite page links to", async () => {
    const request = await GET(req("/join?ref=K7M2QX4P&next=%2Frequest-access"));
    expect(location(request)).toBe("/request-access");
    expect(request.cookies.get("referral_code")?.value).toBe("K7M2QX4P");

    const signIn = await GET(req("/join?ref=K7M2QX4P&next=%2Flogin"));
    expect(location(signIn)).toBe("/login");
    expect(signIn.cookies.get("referral_code")?.value).toBe("K7M2QX4P");
  });

  it("refuses to redirect anywhere else, however next is dressed up", async () => {
    for (const next of [
      "https://evil.example.com",
      "//evil.example.com",
      "/request-access/../../admin",
      "/admin",
      "javascript:alert(1)",
    ]) {
      const res = await GET(req(`/join?ref=K7M2QX4P&next=${encodeURIComponent(next)}`));
      // Falls back to the invite page rather than honouring the destination.
      expect(location(res)).toBe("/join/K7M2QX4P");
      expect(res.headers.get("location")).toBe("http://localhost/join/K7M2QX4P");
    }
  });

  it("sends a link with no code to sign-in, and sets no cookie", async () => {
    const res = await GET(req("/join"));

    expect(location(res)).toBe("/login");
    expect(res.cookies.get("referral_code")).toBeUndefined();
  });

  it("treats a ref that isn't code-shaped as no code at all", async () => {
    for (const ref of ["..%2Fadmin", "a%20b", "%", "K7M2%2FQX4P"]) {
      const res = await GET(req(`/join?ref=${ref}`));
      expect(location(res)).toBe("/login");
      expect(res.cookies.get("referral_code")).toBeUndefined();
    }
  });
});
