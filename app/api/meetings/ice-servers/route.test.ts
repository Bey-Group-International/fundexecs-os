// Production spent ten weeks answering `Metered returned 401` into a log
// nobody read, while every meeting quietly ran on STUN and guests behind
// symmetric NAT could not connect. These tests are about the two things that
// let that happen: a failure that could be cached, and a failure that said
// nothing an operator could act on.

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
  createServiceClient: () => ({}),
  hasSupabaseServiceEnv: () => false,
}));

jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 29, resetAt: Date.now() + 60_000 }),
  clientIp: () => "203.0.113.9",
  rateLimitHeaders: () => ({}),
}));

import { NextRequest } from "next/server";
import { GET, __resetTurnCacheForTests } from "./route";

const REAL_SERVERS = [
  { urls: "stun:relay.metered.test:80" },
  { urls: "turn:relay.metered.test:80", username: "u", credential: "c" },
];

function request() {
  return new NextRequest("https://fundexecs.test/api/meetings/ice-servers?roomCode=abc");
}

/** A fetch that records every call and answers from a queue. */
function fetchReturning(...responses: ({ status: number; body?: unknown } | Error)[]) {
  const calls: string[] = [];
  let i = 0;
  const impl = jest.fn(async (url: unknown) => {
    calls.push(String(url));
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: async () => next.body,
    } as unknown as Response;
  });
  return { impl, calls };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.restoreAllMocks();
  __resetTurnCacheForTests();
  process.env = { ...ORIGINAL_ENV, METERED_API_KEY: "good-key", METERED_APP_NAME: "fundexecs" };
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe("when the provider rejects the credential", () => {
  // The regression. With `next: { revalidate: 3540 }` the 401 response itself
  // was cacheable, so an operator who fixed the key would see nothing change
  // for up to 59 minutes and reasonably conclude the fix had not worked.
  it("does not cache the failure — the next request asks again", async () => {
    const { impl, calls } = fetchReturning({ status: 401 }, { status: 200, body: REAL_SERVERS });
    global.fetch = impl as unknown as typeof fetch;

    const first = await (await GET(request())).json();
    expect(first.relay).toBe(false);
    expect(first.reason).toBe("rejected");

    // Same instance, immediately after: the fixed key must take effect now.
    const second = await (await GET(request())).json();
    expect(second.relay).toBe(true);
    expect(second.iceServers).toEqual(REAL_SERVERS);
    expect(calls).toHaveLength(2);
  });

  it("still answers 200 with STUN, because a call without a relay beats no call", async () => {
    const { impl } = fetchReturning({ status: 401 });
    global.fetch = impl as unknown as typeof fetch;

    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.iceServers.length).toBeGreaterThan(0);
    expect(body.relay).toBe(false);
  });

  it("logs something an operator can act on, not just the status code", async () => {
    const { impl } = fetchReturning({ status: 401 });
    global.fetch = impl as unknown as typeof fetch;
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    await GET(request());

    const line = logged.mock.calls.flat().join(" ");
    expect(line).toMatch(/METERED_API_KEY/);
    expect(line).toMatch(/REJECTED/);
    expect(line).toMatch(/guests/i);
  });
});

describe("when the credential succeeds", () => {
  it("caches it, so one lookup serves the instance", async () => {
    const { impl, calls } = fetchReturning({ status: 200, body: REAL_SERVERS });
    global.fetch = impl as unknown as typeof fetch;

    await GET(request());
    await GET(request());
    await GET(request());

    expect(calls).toHaveLength(1);
  });

  // The env var carrying a trailing newline is the likeliest reason a key that
  // was once right starts answering 401, and the one cause code can fix.
  it("sends the key with the whitespace a dashboard paste adds stripped off", async () => {
    process.env.METERED_API_KEY = "  good-key\n";
    const { impl, calls } = fetchReturning({ status: 200, body: REAL_SERVERS });
    global.fetch = impl as unknown as typeof fetch;

    await GET(request());

    expect(calls[0]).toContain("apiKey=good-key");
    expect(calls[0]).not.toMatch(/%0A|%20good/);
  });

  it("uses the configured app subdomain", async () => {
    process.env.METERED_APP_NAME = "other-app";
    const { impl, calls } = fetchReturning({ status: 200, body: REAL_SERVERS });
    global.fetch = impl as unknown as typeof fetch;

    await GET(request());

    expect(calls[0]).toContain("https://other-app.metered.live/");
  });
});

describe("when there is nothing usable to return", () => {
  it("treats a 200 carrying an empty list as a failure", async () => {
    const { impl } = fetchReturning({ status: 200, body: [] });
    global.fetch = impl as unknown as typeof fetch;

    const body = await (await GET(request())).json();
    expect(body.relay).toBe(false);
    expect(body.reason).toBe("unavailable");
  });

  it("separates a provider outage from a refused key", async () => {
    const { impl } = fetchReturning({ status: 503 });
    global.fetch = impl as unknown as typeof fetch;

    const body = await (await GET(request())).json();
    expect(body.reason).toBe("unavailable");
  });

  it("survives the provider being unreachable", async () => {
    const { impl } = fetchReturning(new Error("ECONNREFUSED"));
    global.fetch = impl as unknown as typeof fetch;

    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe("unavailable");
  });

  it("says so plainly when no key is configured at all", async () => {
    delete process.env.METERED_API_KEY;
    const { impl, calls } = fetchReturning({ status: 200, body: REAL_SERVERS });
    global.fetch = impl as unknown as typeof fetch;

    const body = await (await GET(request())).json();
    expect(body.reason).toBe("unconfigured");
    // Nothing to ask, so nothing is asked.
    expect(calls).toHaveLength(0);
  });
});
