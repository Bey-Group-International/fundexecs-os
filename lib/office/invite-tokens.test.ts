// In-memory fake of the service client's office_invite_tokens table, shaped to
// the loose facade invite-tokens.ts uses (insert / select-eq-maybeSingle /
// update-eq-is-select-maybeSingle). Names are `mock`-prefixed so jest's hoisted
// factory may reference them.
type Row = Record<string, unknown>;
const mockRows: Row[] = [];
const mockHasEnv = jest.fn(() => true);

function mockBuilder(mode: "select" | "update", patch?: Row) {
  const filters: Array<(r: Row) => boolean> = [];
  const api = {
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return api;
    },
    is(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return api;
    },
    select() {
      return api;
    },
    async maybeSingle() {
      const matched = mockRows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        const target = matched[0];
        if (!target) return { data: null, error: null };
        Object.assign(target, patch);
        return { data: { ...target }, error: null };
      }
      return { data: matched[0] ? { ...matched[0] } : null, error: null };
    },
  };
  return api;
}

const mockFrom = (_table: string) => ({
  async insert(row: Row) {
    mockRows.push({ id: `id-${mockRows.length + 1}`, used_at: null, used_by_email: null, ...row });
    return { error: null };
  },
  select: () => mockBuilder("select"),
  update: (patch: Row) => mockBuilder("update", patch),
});

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => mockHasEnv(),
  createServiceClient: () => ({ from: mockFrom }),
}));

import { createInviteToken, consumeInviteToken } from "./invite-tokens";

const T0 = 1_000_000_000_000; // fixed clock

beforeEach(() => {
  mockRows.length = 0;
  mockHasEnv.mockReturnValue(true);
});

describe("createInviteToken", () => {
  it("mints a token and stores a bound, non-expired row", async () => {
    const token = await createInviteToken({
      email: "Guest@Example.com",
      room: "boardroom",
      meet: true,
      inviterEmail: "Host@Example.com",
      now: T0,
      ttlMs: 1000,
    });
    expect(token).toBeTruthy();
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({
      token,
      email: "guest@example.com", // normalized
      room: "boardroom",
      meet: true,
      inviter_email: "host@example.com",
      used_at: null,
    });
  });

  it("returns null (shared-link fallback) with no service env", async () => {
    mockHasEnv.mockReturnValue(false);
    const token = await createInviteToken({ email: "g@e.com" });
    expect(token).toBeNull();
    expect(mockRows).toHaveLength(0);
  });

  it("returns null for an empty email", async () => {
    expect(await createInviteToken({ email: "   " })).toBeNull();
  });
});

describe("consumeInviteToken", () => {
  async function mint(overrides: { email?: string; ttlMs?: number } = {}) {
    return (await createInviteToken({
      email: overrides.email ?? "guest@example.com",
      room: "boardroom",
      meet: true,
      now: T0,
      ttlMs: overrides.ttlMs ?? 60_000,
    }))!;
  }

  it("validates and consumes a fresh token, returning its room/meet", async () => {
    const token = await mint();
    const res = await consumeInviteToken(token, { joinerEmail: "guest@example.com", now: T0 });
    expect(res).toEqual({ ok: true, room: "boardroom", meet: true, deal: null, email: "guest@example.com" });
    expect(mockRows[0].used_at).not.toBeNull();
    expect(mockRows[0].used_by_email).toBe("guest@example.com");
  });

  it("is idempotent for the same invitee reopening the link", async () => {
    const token = await mint();
    await consumeInviteToken(token, { joinerEmail: "guest@example.com", now: T0 });
    const again = await consumeInviteToken(token, { joinerEmail: "guest@example.com", now: T0 + 5 });
    expect(again.ok).toBe(true);
  });

  it("rejects a second, different user (single-use)", async () => {
    const token = await mint();
    await consumeInviteToken(token, { joinerEmail: "guest@example.com", now: T0 });
    const other = await consumeInviteToken(token, { joinerEmail: "someone@else.com", now: T0 + 5 });
    expect(other).toEqual({ ok: false, reason: "used" });
  });

  it("rejects a signed-in joiner whose email isn't the invited one", async () => {
    const token = await mint({ email: "guest@example.com" });
    const res = await consumeInviteToken(token, { joinerEmail: "intruder@example.com", now: T0 });
    expect(res).toEqual({ ok: false, reason: "mismatch" });
    expect(mockRows[0].used_at).toBeNull(); // not consumed
  });

  it("binds an anonymous guest (no email) to the invited address", async () => {
    const token = await mint({ email: "guest@example.com" });
    const res = await consumeInviteToken(token, { joinerEmail: null, now: T0 });
    expect(res.ok).toBe(true);
    expect(mockRows[0].used_by_email).toBe("guest@example.com");
  });

  it("rejects an expired token", async () => {
    const token = await mint({ ttlMs: 1000 });
    const res = await consumeInviteToken(token, { joinerEmail: "guest@example.com", now: T0 + 2000 });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an unknown token", async () => {
    const res = await consumeInviteToken("nope", { now: T0 });
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports unavailable with no service env", async () => {
    mockHasEnv.mockReturnValue(false);
    const res = await consumeInviteToken("anything");
    expect(res).toEqual({ ok: false, reason: "unavailable" });
  });
});
