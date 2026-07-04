import {
  checkRateLimit,
  clearRateLimitBucketsForTests,
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
