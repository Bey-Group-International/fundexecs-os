/**
 * Whether calls can be relayed, as the meetings page asks it.
 *
 * The page warns owners and admins when guests on restrictive networks will
 * fail to connect, so the answer must match what the join path would do — and
 * asking must not log, because it runs on every page view.
 */
import { relayStatus, resetTurnCacheForTests, turnServers } from "./turn-servers.server";

const ENV = { ...process.env };
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  resetTurnCacheForTests();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ENV };
  errorSpy.mockRestore();
});

describe("relayStatus", () => {
  it("reports nothing set up as unconfigured", () => {
    expect(relayStatus()).toEqual({ configured: false, reason: "unconfigured" });
  });

  it("reports URLs without a secret as misconfigured", () => {
    process.env.TURN_URLS = "turn:turn.example.com:3478";
    expect(relayStatus()).toEqual({ configured: false, reason: "misconfigured" });
  });

  it("reports a secret with only a stun: URL as misconfigured", () => {
    process.env.TURN_URLS = "stun:turn.example.com:3478";
    process.env.TURN_SECRET = "s3cret";
    expect(relayStatus()).toEqual({ configured: false, reason: "misconfigured" });
  });

  it("reports a turn: URL and a secret as configured", () => {
    process.env.TURN_URLS = "turn:turn.example.com:3478,turns:turn.example.com:5349";
    process.env.TURN_SECRET = "s3cret";
    expect(relayStatus()).toEqual({ configured: true });
  });

  it("does not log, unlike the join path", () => {
    relayStatus();
    process.env.TURN_URLS = "turn:turn.example.com:3478";
    relayStatus();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("Cloudflare hosted relay", () => {
  const CF_RESPONSE = {
    iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:53?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "cf-user",
        credential: "cf-pass",
      },
    ],
  };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "key-123";
    process.env.CLOUDFLARE_TURN_API_TOKEN = "tok-abc";
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(CF_RESPONSE), { status: 201 }),
    );
  });

  afterEach(() => fetchSpy.mockRestore());

  it("counts as configured, so the admin warning goes away", () => {
    expect(relayStatus()).toEqual({ configured: true });
  });

  it("reports one of the two values alone as misconfigured", () => {
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    expect(relayStatus()).toEqual({ configured: false, reason: "misconfigured" });
  });

  it("asks Cloudflare for credentials and hands out its relay, minus port 53", async () => {
    const turn = await turnServers("abc-defg-hij");
    expect(turn).toEqual({
      relay: true,
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
          username: "cf-user",
          credential: "cf-pass",
        },
      ],
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-abc" });
  });

  it("reuses credentials rather than calling Cloudflare on every join", async () => {
    await turnServers();
    await turnServers();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to STUN, and says why, when Cloudflare refuses the token", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await turnServers()).toEqual({ relay: false, reason: "provider_error" });
    expect(errorSpy.mock.calls[0][0]).toMatch(/Cloudflare answered 401/);
  });

  it("falls back to STUN when Cloudflare cannot be reached", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    expect(await turnServers()).toEqual({ relay: false, reason: "provider_error" });
  });

  it("prefers a self-hosted relay when both are configured", async () => {
    process.env.TURN_URLS = "turn:turn.example.com:3478";
    process.env.TURN_SECRET = "s3cret";
    const turn = await turnServers();
    expect(turn.relay).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
