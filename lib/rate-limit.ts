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

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
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
