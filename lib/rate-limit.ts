type Bucket = {
  count: number;
  resetAt: number;
};

export interface RateLimitPolicy {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

const buckets = new Map<string, Bucket>();

/**
 * The address to rate limit a request by.
 *
 * `x-forwarded-for` is NOT trustworthy on its own, which is the whole point of
 * this function. Any caller may send one, and a proxy APPENDS the address it
 * saw rather than replacing what arrived — so a request carrying
 * `X-Forwarded-For: 1.2.3.4` reaches the handler as `1.2.3.4, <real client>`.
 * Reading the first entry therefore reads a value the attacker chose, and a
 * limiter keyed on it is bypassed by varying the header per request. Every
 * limit in this codebase is keyed on this function, including the public
 * booking endpoints and data-room document access.
 *
 * So the order is by who set the header, not by convenience:
 *
 *  1. `x-vercel-forwarded-for` — set at Vercel's edge and stripped from
 *     anything the client sends, so it cannot be forged in this deployment.
 *  2. `x-real-ip` — likewise overwritten by the platform rather than appended.
 *  3. the LAST `x-forwarded-for` entry — the tail is what the nearest proxy
 *     appended, and an attacker can only prepend. This assumes exactly one
 *     trusted proxy in front of the app, which is what running behind a single
 *     edge gives us; with a chain of N, the correct entry is N from the end.
 *
 * Returns "unknown" when there is nothing to go on, which buckets every such
 * caller together — deliberately strict rather than letting them all through.
 */
export function clientIp(request: Request): string {
  const platform =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-real-ip");
  const direct = platform?.split(",")[0]?.trim();
  if (direct) return direct;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }
  return "unknown";
}

export function checkRateLimit(policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
  const current = buckets.get(policy.key);
  const active = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + policy.windowMs };

  active.count += 1;
  buckets.set(policy.key, active);

  const retryAfter = Math.max(0, Math.ceil((active.resetAt - now) / 1000));
  return {
    ok: active.count <= policy.limit,
    remaining: Math.max(0, policy.limit - active.count),
    resetAt: active.resetAt,
    retryAfter,
  };
}

export function rateLimitHeaders(result: RateLimitResult, limit: number): HeadersInit {
  return {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok ? {} : { "Retry-After": String(result.retryAfter) }),
  };
}

export function rateLimitResponse(result: RateLimitResult, limit: number): Response {
  return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      ...rateLimitHeaders(result, limit),
    },
  });
}

export function clearRateLimitBucketsForTests() {
  buckets.clear();
}
