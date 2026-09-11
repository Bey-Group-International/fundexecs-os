// The endpoint that decides whether a guest on a restrictive network can be
// seen or heard at all. It used to ask a TURN vendor for credentials and spent
// ten weeks being refused; it now computes them from a shared secret, so these
// tests are about what it hands out and who it hands it to.

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

import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { GET } from "./route";

const URLS = "stun:turn.fundexecs.test:3478, turn:turn.fundexecs.test:3478, turns:turn.fundexecs.test:5349";
const SECRET = "shared-with-coturn";

function request(query = "?roomCode=abc") {
  return new NextRequest(`https://fundexecs.test/api/meetings/ice-servers${query}`);
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV, TURN_URLS: URLS, TURN_SECRET: SECRET };
  delete process.env.TURN_TTL_SECONDS;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => { process.env = ORIGINAL_ENV; });

/** The relay entry, which is the only one that carries credentials. */
function relayEntry(body: { iceServers: RTCIceServer[] }) {
  return body.iceServers.find((s) => JSON.stringify(s.urls).includes("turn:"));
}

describe("when a TURN server is configured", () => {
  it("hands out credentials the TURN server can verify itself", async () => {
    const body = await (await GET(request())).json();

    expect(body.relay).toBe(true);
    const entry = relayEntry(body)!;
    expect(entry.urls).toEqual(["turn:turn.fundexecs.test:3478", "turns:turn.fundexecs.test:5349"]);
    // Recomputed the way coturn does under `use-auth-secret`.
    expect(entry.credential).toBe(
      createHmac("sha1", SECRET).update(entry.username as string).digest("base64"),
    );
  });

  // The whole reason the vendor could break this: there is no longer anything
  // to call, so there is nothing to be refused by, rate-limited by, or billed by.
  it("makes no outbound request at all", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await GET(request());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("expires the credential, so a leaked one is worth little", async () => {
    process.env.TURN_TTL_SECONDS = "3600";
    const before = Math.floor(Date.now() / 1000);

    const body = await (await GET(request())).json();

    const expiry = Number.parseInt((relayEntry(body)!.username as string).split(":")[0], 10);
    expect(expiry).toBeGreaterThanOrEqual(before + 3600);
    expect(expiry).toBeLessThanOrEqual(before + 3601);
  });

  // STUN is a public service that rejects authenticated requests, so it must
  // not be handed a username and password.
  it("leaves the STUN entry uncredentialed", async () => {
    const body = await (await GET(request())).json();

    const stun = body.iceServers.find((s: RTCIceServer) => JSON.stringify(s.urls).includes("stun:"));
    expect(stun).toEqual({ urls: ["stun:turn.fundexecs.test:3478"] });
  });

  it("carries the room code into the username, where the relay logs it", async () => {
    const body = await (await GET(request("?roomCode=board-review"))).json();

    expect(relayEntry(body)!.username).toMatch(/^\d+:board-review$/);
  });
});

describe("when TURN is not usable", () => {
  it("says nothing is configured, and still answers with STUN", async () => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_SECRET;

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.relay).toBe(false);
    expect(body.reason).toBe("unconfigured");
    expect(body.iceServers.length).toBeGreaterThan(0);
  });

  // The likelier mistake than either clean case: half the configuration.
  it("separates half-configured from not configured", async () => {
    delete process.env.TURN_SECRET;
    expect((await (await GET(request())).json()).reason).toBe("misconfigured");

    process.env.TURN_SECRET = SECRET;
    process.env.TURN_URLS = "stun:turn.fundexecs.test:3478";
    expect((await (await GET(request())).json()).reason).toBe("misconfigured");
  });

  it("logs which variable is wrong and what it costs", async () => {
    process.env.TURN_URLS = "stun:turn.fundexecs.test:3478";
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    await GET(request());

    const line = logged.mock.calls.flat().join(" ");
    expect(line).toMatch(/TURN_URLS/);
    expect(line).toMatch(/no turn: or turns: entry/);
    expect(line).toMatch(/CGNAT/);
  });

  // A secret that picked up a newline in a dashboard field would otherwise mint
  // credentials the relay rejects, which looks exactly like a wrong secret.
  it("mints from the cleaned secret, not the pasted one", async () => {
    process.env.TURN_SECRET = `  ${SECRET}\n`;

    const body = await (await GET(request())).json();

    const entry = relayEntry(body)!;
    expect(entry.credential).toBe(
      createHmac("sha1", SECRET).update(entry.username as string).digest("base64"),
    );
  });
});
