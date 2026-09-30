/**
 * Whether calls can be relayed, as the meetings page asks it.
 *
 * The page warns owners and admins when guests on restrictive networks will
 * fail to connect, so the answer must match what the join path would do — and
 * asking must not log, because it runs on every page view.
 */
import { relayStatus } from "./turn-servers.server";

const ENV = { ...process.env };
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
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
