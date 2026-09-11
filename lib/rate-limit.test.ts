import {
  checkRateLimit,
  clearRateLimitBucketsForTests,
  clientIp,
  rateLimitHeaders,
} from "./rate-limit";

describe("rate limit", () => {
  beforeEach(() => clearRateLimitBucketsForTests());

  it("allows requests until the limit is exceeded", () => {
    const policy = { key: "org:o1:prompt", limit: 2, windowMs: 1000 };

    expect(checkRateLimit(policy, 100).ok).toBe(true);
    expect(checkRateLimit(policy, 200).ok).toBe(true);

    const third = checkRateLimit(policy, 300);
    expect(third.ok).toBe(false);
    expect(third.retryAfter).toBe(1);
  });

  it("resets after the window expires", () => {
    const policy = { key: "ip:1.2.3.4:import", limit: 1, windowMs: 1000 };

    expect(checkRateLimit(policy, 100).ok).toBe(true);
    expect(checkRateLimit(policy, 200).ok).toBe(false);
    expect(checkRateLimit(policy, 1200).ok).toBe(true);
  });

  it("emits standard rate limit headers", () => {
    const result = checkRateLimit({ key: "k", limit: 3, windowMs: 1000 }, 100);
    expect(rateLimitHeaders(result, 3)).toMatchObject({
      "RateLimit-Limit": "3",
      "RateLimit-Remaining": "2",
      "RateLimit-Reset": "2",
    });
  });
});

/**
 * Which header decides the rate-limit bucket — i.e. the trust boundary.
 *
 * Written down as tests because the failure is invisible: a limiter keyed on a
 * spoofable header still returns 429s, still looks like it works, and simply
 * never stops the one caller it exists to stop. Every limit in this codebase
 * is keyed on clientIp, so this is not local to any one endpoint.
 */
describe("clientIp trust boundary", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/x", { headers });

  it("prefers the platform header the client cannot set", () => {
    // A caller sending their own X-Forwarded-For does not get to choose their
    // bucket: Vercel's edge sets x-vercel-forwarded-for and strips any inbound
    // copy of it.
    expect(clientIp(req({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "198.51.100.2",
    }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, which the platform overwrites rather than appends", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "1.2.3.4" })))
      .toBe("198.51.100.2");
  });

  it("reads the LAST forwarded hop, not the first", () => {
    // The attack this closes: a proxy appends the address it saw, so a caller
    // who sends "1.2.3.4" arrives as "1.2.3.4, <real>". Taking the head reads
    // the attacker's value and lets them mint a fresh bucket per request.
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("cannot be given a fresh bucket by varying the forwarded header", () => {
    const spoofed = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((fake) =>
      clientIp(req({ "x-forwarded-for": `${fake}, 203.0.113.7` })),
    );
    // All three requests are really the same caller, and must share one bucket.
    expect(new Set(spoofed).size).toBe(1);
    expect(spoofed[0]).toBe("203.0.113.7");
  });

  it("handles a single-hop header and stray whitespace", () => {
    expect(clientIp(req({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("buckets callers it cannot identify together rather than letting them through", () => {
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
