jest.mock("server-only", () => ({}), { virtual: true });
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const jar = new Map<string, { value: string }>();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => jar.get(n),
    set: (n: string, value: string) => void jar.set(n, { value }),
  }),
}));

import { getLinkSession, grantLpPass, hasLpPass, hashCode, issueCode, verifyCode } from "./lp-access.server";

// A small in-memory lp_link_codes / sessions table that understands just the queries this module makes.
interface Row extends Record<string, unknown> {
  id: string;
  session_id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  created_at: string;
}
let codes: Row[] = [];
let insertError: { code: string; message: string } | null = null;
let sessionRow: Record<string, unknown> | null = null;
let n = 0;
let afterRead: (() => void) | null = null;

function fake() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let action: "select" | "update" | "insert" = "select";
      let patch: Record<string, unknown> = {};
      let order: "desc" | null = null;
      let limit = Infinity;
      let wantRows = false;
      const matching = () => {
        let rows = codes.filter((r) => filters.every((f) => f(r)));
        if (order) rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        return rows.slice(0, limit);
      };
      const run = () => {
        if (table === "lp_onboarding_sessions") return { data: sessionRow, error: null };
        if (action === "insert") {
          if (insertError) return { data: null, error: insertError };
          return { data: null, error: null };
        }
        const rows = matching();
        if (action === "update") {
          rows.forEach((r) => Object.assign(r, patch));
          return { data: wantRows ? rows.map((r) => ({ id: r.id })) : null, error: null };
        }
        return { data: rows, error: null };
      };
      const q: Record<string, unknown> = {
        select: (cols?: string) => {
          if (action === "update") wantRows = true;
          void cols;
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        order: () => ((order = "desc"), q),
        limit: (v: number) => ((limit = v), q),
        update: (p: Record<string, unknown>) => ((action = "update"), (patch = p), q),
        insert: (row: Record<string, unknown>) => {
          action = "insert";
          if (!insertError) codes.push({ id: `c${++n}`, attempts: 0, consumed_at: null, created_at: new Date(now()).toISOString(), ...row } as Row);
          return q;
        },
        maybeSingle: async () => {
          const r = run();
          const out = { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
          afterRead?.();
          return out;
        },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return q;
    },
  } as never;
}

let clock = Date.parse("2026-10-31T12:00:00Z");
const now = () => clock;

beforeEach(() => {
  codes = [];
  afterRead = null;
  jar.clear();
  insertError = null;
  sessionRow = null;
  clock = Date.parse("2026-10-31T12:00:00Z");
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const session = { id: "s1", organization_id: "org-1" };

describe("getLinkSession", () => {
  const live = { id: "s1", organization_id: "o", lp_name: "A", lp_email: "a@b.co", status: "pending", review_state: "not_started", lp_type: "individual", owner_threshold_pct: 25, expires_at: "2099-01-01T00:00:00Z" };
  it("returns a live session", async () => {
    sessionRow = live;
    expect(await getLinkSession(fake(), "x".repeat(32))).toMatchObject({ id: "s1" });
  });
  it("refuses a missing, expired or lapsed link, and a token of the wrong shape", async () => {
    sessionRow = null;
    expect(await getLinkSession(fake(), "x".repeat(32))).toBeNull();
    sessionRow = { ...live, expires_at: "2020-01-01T00:00:00Z" };
    expect(await getLinkSession(fake(), "x".repeat(32))).toBeNull();
    sessionRow = { ...live, status: "expired" };
    expect(await getLinkSession(fake(), "x".repeat(32))).toBeNull();
    sessionRow = live;
    expect(await getLinkSession(fake(), "short")).toBeNull();
    expect(await getLinkSession(fake(), "x".repeat(201))).toBeNull();
    expect(await getLinkSession(fake(), undefined as never)).toBeNull();
  });
});

describe("issuing and verifying a code", () => {
  it("round-trips: a code issued can be entered once", async () => {
    const issued = await issueCode(fake(), session, "email", null, clock);
    if (!issued.ok) throw new Error("expected a code");
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(codes).toHaveLength(1);
    // Only a hash is stored.
    expect(JSON.stringify(codes[0])).not.toContain(issued.code);
    expect(codes[0].code_hash).toBe(hashCode("s1", issued.code));

    expect(await verifyCode(fake(), session, issued.code, clock + 1000)).toEqual({ ok: true });
    const again = await verifyCode(fake(), session, issued.code, clock + 2000);
    expect(again.ok).toBe(false);
  });

  it("lets only one of two simultaneous requests use the same code", async () => {
    const issued = await issueCode(fake(), session, "email", null, clock);
    if (!issued.ok) throw new Error("expected a code");
    // Another request uses the code after this one has read it but before it records its use.
    afterRead = () => {
      codes[0].consumed_at = new Date(clock).toISOString();
      afterRead = null;
    };
    const res = await verifyCode(fake(), session, issued.code, clock + 1000);
    expect(res).toEqual({ ok: false, error: "That code has already been used. Ask for a new one.", reason: "used" });
  });

  it("accepts a code typed with a space", async () => {
    const issued = await issueCode(fake(), session, "gp", "user-1", clock);
    if (!issued.ok) throw new Error("expected a code");
    expect(codes[0].kind).toBe("gp");
    expect(codes[0].created_by).toBe("user-1");
    const spaced = `${issued.code.slice(0, 3)} ${issued.code.slice(3)}`;
    expect((await verifyCode(fake(), session, spaced, clock + 1000)).ok).toBe(true);
  });

  it("binds a code to its session", async () => {
    const issued = await issueCode(fake(), session, "email", null, clock);
    if (!issued.ok) throw new Error("expected a code");
    expect(hashCode("s2", issued.code)).not.toBe(hashCode("s1", issued.code));
  });

  it("rejects a wrong code, and locks after five wrong tries even for the right code", async () => {
    const issued = await issueCode(fake(), session, "email", null, clock);
    if (!issued.ok) throw new Error("expected a code");
    const wrong = issued.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect(await verifyCode(fake(), session, wrong, clock + 1000)).toEqual({ ok: false, error: "That code isn't right.", reason: "wrong" });
    }
    expect(codes[0].attempts).toBe(5);
    const locked = await verifyCode(fake(), session, issued.code, clock + 1000);
    expect(locked).toEqual({ ok: false, error: "Too many wrong codes. Ask for a new one.", reason: "locked" });
  });

  it("rejects an expired code", async () => {
    const issued = await issueCode(fake(), session, "email", null, clock);
    if (!issued.ok) throw new Error("expected a code");
    const res = await verifyCode(fake(), session, issued.code, clock + 16 * 60 * 1000);
    expect(res.ok).toBe(false);
    expect((await verifyCode(fake(), session, issued.code, clock + 14 * 60 * 1000)).ok).toBe(true);
  });

  it("rejects input that is not six digits without spending a try", async () => {
    await issueCode(fake(), session, "email", null, clock);
    expect((await verifyCode(fake(), session, "12", clock)).ok).toBe(false);
    expect(codes[0].attempts).toBe(0);
  });

  it("retires the older code when a new one is issued", async () => {
    const first = await issueCode(fake(), session, "email", null, clock);
    const second = await issueCode(fake(), session, "email", null, clock + 61_000);
    if (!first.ok || !second.ok) throw new Error("expected codes");
    // The old code no longer works, the new one does. (Guard against the unlikely clash of two random codes.)
    if (first.code !== second.code) expect((await verifyCode(fake(), session, first.code, clock + 62_000)).ok).toBe(false);
    expect((await verifyCode(fake(), session, second.code, clock + 62_000)).ok).toBe(true);
  });

  it("rate limits issuing", async () => {
    expect((await issueCode(fake(), session, "email", null, clock)).ok).toBe(true);
    const tooSoon = await issueCode(fake(), session, "email", null, clock + 10_000);
    expect(tooSoon.ok).toBe(false);
    expect(codes).toHaveLength(1);
  });

  it("reports a failed insert without leaking the database error", async () => {
    insertError = { code: "42501", message: "row-level security" };
    const res = await issueCode(fake(), session, "email", null, clock);
    expect(res).toEqual({ ok: false, error: "Couldn't create a code. Try again." });
  });
});

describe("the LP's pass", () => {
  it("is absent until granted, then valid for that session only", async () => {
    expect(await hasLpPass("s1", clock)).toBe(false);
    await grantLpPass("s1", clock);
    expect(await hasLpPass("s1", clock + 1000)).toBe(true);
    expect(await hasLpPass("s2", clock + 1000)).toBe(false);
  });

  it("lapses after six hours", async () => {
    await grantLpPass("s1", clock);
    expect(await hasLpPass("s1", clock + 5 * 3600_000)).toBe(true);
    expect(await hasLpPass("s1", clock + 7 * 3600_000)).toBe(false);
  });

  it("cannot be moved to another session or forged", async () => {
    await grantLpPass("s1", clock);
    const value = jar.get("fx_lp_s1")!.value;
    jar.set("fx_lp_s2", { value }); // a pass for s1 presented for s2
    expect(await hasLpPass("s2", clock)).toBe(false);

    const [body, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "s2", iat: clock }), "utf8").toString("base64url");
    jar.set("fx_lp_s2", { value: `${forged}.${mac}` });
    expect(await hasLpPass("s2", clock)).toBe(false);
    jar.set("fx_lp_s1", { value: `${body}.garbage` });
    expect(await hasLpPass("s1", clock)).toBe(false);
    jar.set("fx_lp_s1", { value: "nodot" });
    expect(await hasLpPass("s1", clock)).toBe(false);
  });
});

// SOC 2 gap G-5: what codes and passes are signed with.
describe("the signing key", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const saved = { dedicated: process.env.LP_ACCESS_SECRET, previous: process.env.LP_ACCESS_SECRET_PREVIOUS, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const set = (name: string, v: string | undefined) => (v === undefined ? delete process.env[name] : (process.env[name] = v));
  afterEach(() => {
    set("LP_ACCESS_SECRET", saved.dedicated);
    set("LP_ACCESS_SECRET_PREVIOUS", saved.previous);
    set("SUPABASE_SERVICE_ROLE_KEY", saved.service);
    jar.clear();
  });
  const useOnly = (dedicated?: string, previous?: string) => {
    set("LP_ACCESS_SECRET", dedicated);
    set("LP_ACCESS_SECRET_PREVIOUS", previous);
  };

  it("falls back to the service-role key until a dedicated key is set, so deploying changes nothing", () => {
    useOnly(undefined);
    const before = hashCode("s1", "123456");
    set("SUPABASE_SERVICE_ROLE_KEY", "a-different-service-key");
    expect(hashCode("s1", "123456")).not.toBe(before);
  });

  it("once a dedicated key is set, the service-role key no longer matters", () => {
    useOnly(A);
    const h = hashCode("s1", "123456");
    set("SUPABASE_SERVICE_ROLE_KEY", "something-else-entirely");
    expect(hashCode("s1", "123456")).toBe(h);
    set("SUPABASE_SERVICE_ROLE_KEY", saved.service);
    useOnly(B);
    expect(hashCode("s1", "123456")).not.toBe(h);
  });

  it("ignores a dedicated key that is too short, and says nothing is weaker than the fallback", () => {
    useOnly("too-short");
    const withShort = hashCode("s1", "123456");
    useOnly(undefined);
    expect(withShort).toBe(hashCode("s1", "123456")); // still the service-role key
  });

  it("a pass made under the service-role key stops working once a dedicated key is set", async () => {
    useOnly(undefined);
    await grantLpPass("s1", clock);
    expect(await hasLpPass("s1", clock + 1000)).toBe(true);
    useOnly(A);
    expect(await hasLpPass("s1", clock + 1000)).toBe(false);
  });

  it("a code issued under the old key still verifies during a rotation, and not after", async () => {
    useOnly(A);
    const issued = await issueCode(fake(), session, "email", null, clock);
    if (!issued.ok) throw new Error("expected a code");
    useOnly(B, A); // rotated: new key, old one kept for now
    expect(await verifyCode(fake(), session, issued.code, clock + 1000)).toEqual({ ok: true });

    codes = [];
    useOnly(A);
    const again = await issueCode(fake(), session, "email", null, clock);
    if (!again.ok) throw new Error("expected a code");
    useOnly(B); // old key removed
    expect((await verifyCode(fake(), session, again.code, clock + 1000)).ok).toBe(false);
  });

  it("a pass made under the old key still works during a rotation, and not after; new passes use the new key", async () => {
    useOnly(A);
    await grantLpPass("s1", clock);
    useOnly(B, A);
    expect(await hasLpPass("s1", clock + 1000)).toBe(true);
    await grantLpPass("s2", clock);
    useOnly(B); // old key removed
    expect(await hasLpPass("s1", clock + 1000)).toBe(false);
    expect(await hasLpPass("s2", clock + 1000)).toBe(true);
  });

  it("with no usable key it signs nothing and accepts nothing, rather than using an empty key", async () => {
    useOnly(undefined);
    set("SUPABASE_SERVICE_ROLE_KEY", undefined);
    expect(() => hashCode("s1", "123456")).toThrow(/LP_ACCESS_SECRET/);
    await expect(grantLpPass("s1", clock)).rejects.toThrow(/LP_ACCESS_SECRET/);
    // A value an attacker would build against an empty key is not accepted.
    const body = Buffer.from(JSON.stringify({ sid: "s1", iat: clock }), "utf8").toString("base64url");
    const mac = require("crypto").createHmac("sha256", require("crypto").createHmac("sha256", "fx-lp-pass").update("").digest("hex")).update(body).digest("base64url");
    jar.set("fx_lp_s1", { value: `${body}.${mac}` });
    expect(await hasLpPass("s1", clock)).toBe(false);
  });
});
