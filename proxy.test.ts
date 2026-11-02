/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const updateSession = jest.fn(async (request: NextRequest) => NextResponse.next({ request }));
jest.mock("@/lib/supabase/middleware", () => ({ updateSession: (r: NextRequest) => updateSession(r) }));

import { config, proxy } from "@/proxy";

// Next compiles `matcher` with path-to-regexp; this one is a plain negative
// lookahead, which reads the same as a RegExp anchored at both ends.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it("runs on pages and API routes, which need the session refresh", () => {
    for (const path of ["/", "/meetings/abc", "/api/meetings/abc/recording/1/stream", "/join/CODE"]) {
      expect(matcher.test(path)).toBe(true);
    }
  });

  it("skips the self-hosted segmenter files, which are static", () => {
    for (const path of [
      "/mediapipe/vision_wasm_internal.wasm",
      "/mediapipe/vision_wasm_internal.js",
      "/mediapipe/selfie_segmenter.tflite",
    ]) {
      expect(matcher.test(path)).toBe(false);
    }
  });

  it("still skips the assets it always skipped", () => {
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.svg", "/hero.webp"]) {
      expect(matcher.test(path)).toBe(false);
    }
  });

  it("skips the CSP report endpoint, which needs no session", () => {
    expect(matcher.test("/api/csp-report")).toBe(false);
    expect(matcher.test("/api/csp-reports-admin")).toBe(false);
  });

  it("does not swallow a page whose name merely starts with the folder's", () => {
    expect(matcher.test("/mediapipe-notes")).toBe(true);
  });
});

describe("proxy and the investor pages' report-only policy", () => {
  const call = (path: string) => proxy(new NextRequest(`https://app.test${path}`));

  beforeEach(() => updateSession.mockClear());

  it("sends the nonce policy report-only on an investor page, and tells Next.js the same one", async () => {
    const res = await call("/lp/some-token-value-1234");
    const header = res.headers.get("content-security-policy-report-only")!;
    expect(header).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(header).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // the request handed on carries it, which is how Next.js picks the nonce up for its own scripts
    expect(updateSession.mock.calls[0][0].headers.get("content-security-policy-report-only")).toBe(header);
  });

  it("never sends the enforced policy itself: that stays with next.config", async () => {
    const res = await call("/lp/some-token-value-1234");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("uses a different nonce for every request", async () => {
    const nonce = async () => (await call("/lp/t")).headers.get("content-security-policy-report-only")!.match(/'nonce-([^']+)'/)![1];
    const [a, b] = [await nonce(), await nonce()];
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });

  it("leaves every other page alone", async () => {
    for (const path of ["/", "/run/onboarding", "/lpx", "/api/lp/abc"]) {
      const res = await call(path);
      expect(res.headers.get("content-security-policy-report-only")).toBeNull();
      expect(updateSession.mock.calls.at(-1)![0].headers.get("content-security-policy-report-only")).toBeNull();
    }
  });
});
