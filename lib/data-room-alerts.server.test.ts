jest.mock("server-only", () => ({}), { virtual: true });
const sendEmail = jest.fn();
jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { MAX_NEW_READERS_PER_HOUR, recordFirstOpen, sendDataRoomDigests } from "./data-room-alerts.server";

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase client for these two functions: equality and
 * range filters, `in`, head counts, upsert-ignore-duplicates on a composite
 * key, and update. Every builder is awaitable.
 */
function fakeDb(tables: Record<string, Row[]>, users: Record<string, string>) {
  const updates: { table: string; patch: Row; ids: unknown[] }[] = [];
  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    let op: "select" | "upsert" | "update" = "select";
    let head = false;
    let payload: Row | null = null;
    let inIds: unknown[] = [];
    const api: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return api;
      },
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), api),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), api),
      gt: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) > v)), api),
      lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), api),
      in: (c: string, v: unknown[]) => {
        inIds = v;
        rows = rows.filter((r) => v.includes(r[c]));
        return api;
      },
      limit: () => api,
      order: () => api,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
      upsert: (p: Row) => {
        op = "upsert";
        payload = p;
        return api;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return api;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (op === "upsert") {
          const t = (tables[table] ??= []);
          const dup = t.some((r) => r.share_id === payload!.share_id && r.viewer_key === payload!.viewer_key);
          if (dup) return Promise.resolve({ data: [] }).then(resolve);
          t.push({ ...payload, created_at: new Date().toISOString() });
          return Promise.resolve({ data: [payload] }).then(resolve);
        }
        if (op === "update") {
          updates.push({ table, patch: payload!, ids: inIds });
          return Promise.resolve({ data: null }).then(resolve);
        }
        return Promise.resolve(head ? { count: rows.length, data: null } : { data: rows }).then(resolve);
      },
    };
    return api;
  }
  const client = {
    from: (t: string) => builder(t),
    auth: {
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: users[id] ? { user: { email: users[id] } } : null }),
      },
    },
  };
  return { client: client as never, updates, tables };
}

const share = {
  id: "share-1",
  organization_id: "org-1",
  room_id: "room-1",
  label: "Fund II LPs",
  notify_on_open: true,
  created_by: "gp-1",
};

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, channel: "gmail", detail: "" });
});

describe("recordFirstOpen", () => {
  it("emails the creator on a reader's first open and never again", async () => {
    const db = fakeDb({ data_rooms: [{ id: "room-1", name: "Fund II" }] }, { "gp-1": "gp@fund.com" });
    expect(await recordFirstOpen(db.client, share, "email:lp@x.com", "lp@x.com")).toBe(true);
    expect(await recordFirstOpen(db.client, share, "email:lp@x.com", "lp@x.com")).toBe(false);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to.email).toBe("gp@fund.com");
    expect(msg.subject).toBe("lp@x.com opened Fund II LPs");
    expect(msg.htmlBody).toContain("Fund II");
  });

  it("alerts separately for a second reader", async () => {
    const db = fakeDb({}, { "gp-1": "gp@fund.com" });
    await recordFirstOpen(db.client, share, "email:a@x.com", "a@x.com");
    await recordFirstOpen(db.client, share, "visitor:abcdef12", null);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("records the open but sends nothing when alerts are off", async () => {
    const db = fakeDb({}, { "gp-1": "gp@fund.com" });
    expect(await recordFirstOpen(db.client, { ...share, notify_on_open: false }, "email:a@x.com", "a@x.com")).toBe(true);
    expect(db.tables.data_room_open_alerts).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stops alerting once a link sees too many new readers in an hour", async () => {
    const now = new Date().toISOString();
    const flood = Array.from({ length: MAX_NEW_READERS_PER_HOUR }, (_, i) => ({
      share_id: "share-1",
      viewer_key: `visitor:flood${i}xx`,
      created_at: now,
    }));
    const db = fakeDb({ data_room_open_alerts: flood }, { "gp-1": "gp@fund.com" });
    expect(await recordFirstOpen(db.client, share, "visitor:onemore1", null)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendDataRoomDigests", () => {
  const now = new Date("2026-10-02T13:00:00Z");
  const digestShare = (id: string, over: Row = {}) => ({
    id,
    organization_id: "org-1",
    room_id: "room-1",
    label: id,
    created_by: "gp-1",
    digest_sent_at: null,
    revoked_at: null,
    daily_digest: true,
    ...over,
  });
  const view = (share_id: string, over: Row = {}) => ({
    share_id,
    viewer_email: "lp@x.com",
    session_id: "s1",
    document_id: null,
    kind: "room",
    duration_seconds: null,
    created_at: "2026-10-02T09:00:00Z",
    ...over,
  });

  it("sends one email per creator covering every active link, and advances their windows", async () => {
    const db = fakeDb(
      {
        data_room_shares: [digestShare("a"), digestShare("b"), digestShare("quiet")],
        data_room_views: [view("a"), view("b", { document_id: "ppm", kind: "document", duration_seconds: 90 })],
        documents: [{ id: "ppm", name: "PPM v3" }],
        data_rooms: [{ id: "room-1", name: "Fund II" }],
      },
      { "gp-1": "gp@fund.com" },
    );
    expect(await sendDataRoomDigests(db.client, now)).toEqual({ links: 2, emails: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].htmlBody).toContain("PPM v3");
    expect(db.updates).toEqual([{ table: "data_room_shares", patch: { digest_sent_at: now.toISOString() }, ids: ["a", "b"] }]);
  });

  it("names Earn's hot investors active in the creator's rooms today", async () => {
    const db = fakeDb(
      {
        data_room_shares: [digestShare("a")],
        data_room_views: [view("a")],
        data_rooms: [{ id: "room-1", name: "Fund II" }],
        data_room_engagement_reads: [
          { organization_id: "org-1", room_id: "room-1", viewer_key: "email:lp@x.com", signal: "hot", summary: "Deep in the PPM.", follow_up: "Offer a terms call.", activity_through: "2026-10-02T09:00:00Z" },
          { organization_id: "org-1", room_id: "room-1", viewer_key: "email:old@x.com", signal: "hot", summary: "Old news.", follow_up: "x", activity_through: "2026-09-01T09:00:00Z" },
          { organization_id: "org-1", room_id: "room-1", viewer_key: "email:meh@x.com", signal: "warm", summary: "Skimmed.", follow_up: "x", activity_through: "2026-10-02T09:00:00Z" },
        ],
      },
      { "gp-1": "gp@fund.com" },
    );
    await sendDataRoomDigests(db.client, now);
    const html = sendEmail.mock.calls[0][0].htmlBody as string;
    expect(html).toContain("Deep in the PPM.");
    expect(html).not.toContain("Old news.");
    expect(html).not.toContain("Skimmed.");
  });

  it("reports nothing already reported", async () => {
    const db = fakeDb(
      {
        data_room_shares: [digestShare("a", { digest_sent_at: "2026-10-02T10:00:00Z" })],
        data_room_views: [view("a")], // 09:00, before the last report
      },
      { "gp-1": "gp@fund.com" },
    );
    expect(await sendDataRoomDigests(db.client, now)).toEqual({ links: 0, emails: 0 });
  });

  it("keeps the window open when the email could not be sent", async () => {
    sendEmail.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox" });
    const db = fakeDb(
      { data_room_shares: [digestShare("a")], data_room_views: [view("a")] },
      { "gp-1": "gp@fund.com" },
    );
    expect(await sendDataRoomDigests(db.client, now)).toEqual({ links: 0, emails: 0 });
    expect(db.updates).toEqual([]);
  });

  it("skips links with the digest off or revoked", async () => {
    const db = fakeDb(
      {
        data_room_shares: [digestShare("off", { daily_digest: false }), digestShare("gone", { revoked_at: "2026-10-01T00:00:00Z" })],
        data_room_views: [view("off"), view("gone")],
      },
      { "gp-1": "gp@fund.com" },
    );
    expect(await sendDataRoomDigests(db.client, now)).toEqual({ links: 0, emails: 0 });
  });
});
