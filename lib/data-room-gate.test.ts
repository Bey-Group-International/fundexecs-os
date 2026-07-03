// Data room gate: the server-side proof-of-pass that replaced the old
// client-side `gatePassed` boolean. `gateSatisfied` is the single function
// that decides whether confidential content may be sent — these are the tests
// that must hold for the fix to actually close the leak.

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

// A tiny in-memory stand-in for Next's cookie store, matching the subset of
// the `cookies()` API (`get`/`set`) that grantGate/readGatePass use.
const cookieJar = new Map<string, { value: string }>();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => {
      cookieJar.set(name, { value });
    },
  }),
}));

import { gateSatisfied, grantGate, readGatePass, type GatePassPayload } from "@/lib/data-room-gate";

beforeEach(() => cookieJar.clear());

function pass(overrides: Partial<GatePassPayload> = {}): GatePassPayload {
  return { shareId: "share-1", pwd: false, nda: false, email: null, iat: Date.now(), ...overrides };
}

describe("gateSatisfied", () => {
  it("passes a share with no requirements even with no pass at all", () => {
    expect(
      gateSatisfied({ require_email: false, require_nda: false, password_hash: null }, null),
    ).toBe(true);
  });

  it("requires a password to have been verified when password_hash is set", () => {
    const share = { require_email: false, require_nda: false, password_hash: "pbkdf2:x:y" };
    expect(gateSatisfied(share, null)).toBe(false);
    expect(gateSatisfied(share, pass({ pwd: false }))).toBe(false);
    expect(gateSatisfied(share, pass({ pwd: true }))).toBe(true);
  });

  it("requires an NDA signature when require_nda is set", () => {
    const share = { require_email: false, require_nda: true, password_hash: null };
    expect(gateSatisfied(share, null)).toBe(false);
    expect(gateSatisfied(share, pass({ nda: false }))).toBe(false);
    expect(gateSatisfied(share, pass({ nda: true }))).toBe(true);
  });

  it("requires a captured email when require_email is set", () => {
    const share = { require_email: true, require_nda: false, password_hash: null };
    expect(gateSatisfied(share, null)).toBe(false);
    expect(gateSatisfied(share, pass({ email: null }))).toBe(false);
    expect(gateSatisfied(share, pass({ email: "lp@example.com" }))).toBe(true);
  });

  it("requires ALL configured gates, not just one", () => {
    const share = { require_email: true, require_nda: true, password_hash: "pbkdf2:x:y" };
    // Two of three satisfied is still a fail — this is exactly the bug class
    // the fix targets: a partial pass must never unlock full content.
    expect(gateSatisfied(share, pass({ email: "lp@example.com", nda: true, pwd: false }))).toBe(false);
    expect(gateSatisfied(share, pass({ email: "lp@example.com", nda: true, pwd: true }))).toBe(true);
  });

  it("does not accidentally satisfy an unrelated share's requirements", () => {
    // gateSatisfied itself is share-agnostic (shareId matching happens in
    // readGatePass); this test documents that a pass for the WRONG flags
    // still correctly fails regardless of which share object is passed in.
    const strict = { require_email: true, require_nda: true, password_hash: "pbkdf2:x:y" };
    const bareMinimumPass = pass({ email: null, nda: false, pwd: false });
    expect(gateSatisfied(strict, bareMinimumPass)).toBe(false);
  });
});

describe("grantGate / readGatePass round-trip", () => {
  it("accumulates independently-granted gates onto the same signed pass", async () => {
    await grantGate("share-1", { email: "lp@example.com" });
    await grantGate("share-1", { nda: true });
    await grantGate("share-1", { pwd: true });

    const read = await readGatePass("share-1");
    expect(read).toMatchObject({ shareId: "share-1", email: "lp@example.com", nda: true, pwd: true });
  });

  it("never grants a share's cookie access to a different share", async () => {
    await grantGate("share-1", { pwd: true });
    expect(await readGatePass("share-2")).toBeNull();
  });

  it("rejects a tampered cookie value instead of trusting it", async () => {
    await grantGate("share-1", { pwd: true });
    const cookieName = "fx_dr_gate_share-1";
    const stored = cookieJar.get(cookieName)!.value;
    // Flip the payload body but keep the original signature — a forged
    // "pwd: true" claim without ever verifying the password.
    const [, mac] = stored.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ shareId: "share-1", pwd: true, nda: true, email: null, iat: Date.now() }), "utf8").toString("base64url");
    cookieJar.set(cookieName, { value: `${forgedBody}.${mac}` });

    expect(await readGatePass("share-1")).toBeNull();
  });

  it("rejects an expired pass", async () => {
    await grantGate("share-1", { pwd: true });
    const cookieName = "fx_dr_gate_share-1";
    const current = await readGatePass("share-1");
    expect(current).not.toBeNull();

    // Re-sign with an `iat` far enough in the past to exceed the TTL, using
    // the same secret derivation the module uses internally.
    const { createHmac } = await import("crypto");
    const stale = { ...current, iat: Date.now() - 1000 * 60 * 60 * 24 * 30 };
    const body = Buffer.from(JSON.stringify(stale), "utf8").toString("base64url");
    const secret = createHmac("sha256", "fx-data-room-gate").update(process.env.SUPABASE_SERVICE_ROLE_KEY!).digest("hex");
    const mac = createHmac("sha256", secret).update(body).digest("base64url");
    cookieJar.set(cookieName, { value: `${body}.${mac}` });

    expect(await readGatePass("share-1")).toBeNull();
  });
});
