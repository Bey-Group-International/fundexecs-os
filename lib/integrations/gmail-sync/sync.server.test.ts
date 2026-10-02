// The mailbox sweep against a fake Gmail and a fake database. What is under
// test is the cursor: where a run starts, what it reads, and when it is safe to
// move the cursor on. Ingest itself is covered in inbound/ingest.test.ts.
import { isMailboxDue, syncOrgMailbox, MAX_MESSAGES } from "./sync.server";

const ingest = jest.fn();
jest.mock("@/lib/integrations/inbound/ingest", () => ({
  ingestInboundEvent: (...args: unknown[]) => ingest(...args),
}));
jest.mock("@/lib/google-oauth", () => ({
  getGoogleAccessToken: jest.fn(async () => null),
  googleOAuthConfigured: () => true,
}));

const MAILBOX = "deals@fund.com";

function b64(text: string) {
  return Buffer.from(text).toString("base64url");
}

function gmailMessage(id: string, from = "Ana <ana@acme.com>") {
  return {
    id,
    threadId: `t-${id}`,
    labelIds: ["INBOX"],
    internalDate: "1790000000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: MAILBOX },
        { name: "Subject", value: "Hello" },
      ],
      body: { data: b64(`body ${id}`) },
    },
  };
}

function makeDb(state: Record<string, unknown> | null, ingested: string[] = []) {
  const saved: Record<string, unknown>[] = [];
  const logInserts: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: (_col: string, values: string[]) =>
        Promise.resolve({
          data: table === "ingest_log" ? values.filter((v) => ingested.includes(v)).map((v) => ({ external_id: v })) : [],
          error: null,
        }),
      maybeSingle: async () => ({ data: state, error: null }),
      upsert: async (row: Record<string, unknown>) => {
        saved.push(row);
        return { error: null };
      },
      insert: async (row: Record<string, unknown>) => {
        logInserts.push(row);
        return { error: null };
      },
    };
    return chain;
  };
  return { client: { from } as never, saved, logInserts };
}

function fakeGmail(routes: Record<string, unknown | number>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    const path = url.replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
    calls.push(path);
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    const value = key ? routes[key] : 404;
    if (typeof value === "number") return new Response("{}", { status: value });
    return new Response(JSON.stringify(value), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  ingest.mockReset();
  ingest.mockResolvedValue({ ok: true, duplicate: false, threadId: "thr", created: true });
});

describe("syncOrgMailbox", () => {
  it("backfills a first sync and starts the cursor at the profile's historyId", async () => {
    const db = makeDb(null);
    const gmail = fakeGmail({
      "/profile": { emailAddress: MAILBOX, historyId: "500" },
      "/messages?": { messages: [{ id: "b" }, { id: "a" }] },
      "/messages/a": gmailMessage("a"),
      "/messages/b": gmailMessage("b"),
    });
    const r = await syncOrgMailbox(db.client, "org-1", { fetchImpl: gmail.fetchImpl, accessToken: "tok" });
    expect(r).toMatchObject({ status: "ok", fetched: 2, ingested: 2, incomplete: false });
    // Oldest first: Gmail lists newest first.
    expect(ingest.mock.calls.map((c) => (c[3] as { eventId: string }).eventId)).toEqual(["gmail:a", "gmail:b"]);
    expect(db.saved.at(-1)).toMatchObject({ history_id: "500", mailbox_email: MAILBOX, status: "ok" });
  });

  it("reads only history after the cursor and skips what is already ingested", async () => {
    const db = makeDb({ history_id: "500", mailbox_email: MAILBOX, consecutive_failures: 0, messages_ingested: 2 }, [
      "gmail:a",
    ]);
    const gmail = fakeGmail({
      "/history?": {
        history: [{ messagesAdded: [{ message: { id: "a" } }, { message: { id: "c" } }] }],
        historyId: "600",
      },
      "/messages/c": gmailMessage("c"),
    });
    const r = await syncOrgMailbox(db.client, "org-1", { fetchImpl: gmail.fetchImpl, accessToken: "tok" });
    expect(r).toMatchObject({ fetched: 1, ingested: 1 });
    expect(gmail.calls.some((c) => c.startsWith("/messages/a"))).toBe(false);
    expect(db.saved.at(-1)).toMatchObject({ history_id: "600", messages_ingested: 3 });
  });

  it("claims skipped mail so an unfinished run does not re-read it forever", async () => {
    const db = makeDb({ history_id: "500", mailbox_email: MAILBOX, consecutive_failures: 0, messages_ingested: 0 });
    const gmail = fakeGmail({
      "/history?": { history: [{ messagesAdded: [{ message: { id: "n" } }] }], historyId: "501" },
      "/messages/n": gmailMessage("n", "noreply@vendor.com"),
    });
    const r = await syncOrgMailbox(db.client, "org-1", { fetchImpl: gmail.fetchImpl, accessToken: "tok" });
    expect(r).toMatchObject({ skipped: 1, ingested: 0 });
    expect(ingest).not.toHaveBeenCalled();
    expect(db.logInserts).toEqual([
      expect.objectContaining({ external_id: "gmail:n", channel: "gmail_sync", detail: "skipped: automated_sender" }),
    ]);
  });

  it("holds the cursor when more mail is waiting than one run takes", async () => {
    const ids = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => `m${i}`);
    const db = makeDb({ history_id: "500", mailbox_email: MAILBOX, consecutive_failures: 0, messages_ingested: 0 });
    const routes: Record<string, unknown> = {
      "/history?": { history: [{ messagesAdded: ids.map((id) => ({ message: { id } })) }], historyId: "900" },
    };
    const gmail = fakeGmail(routes);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const m = /\/messages\/([^?]+)/.exec(url);
      if (m) return new Response(JSON.stringify(gmailMessage(m[1])), { status: 200 });
      return gmail.fetchImpl(url, init);
    }) as typeof fetch;
    const r = await syncOrgMailbox(db.client, "org-1", { fetchImpl, accessToken: "tok" });
    expect(r).toMatchObject({ fetched: MAX_MESSAGES, incomplete: true });
    expect(db.saved.at(-1)).toMatchObject({ history_id: "500" });
  });

  it("resets to a backfill when Gmail has expired the cursor", async () => {
    const db = makeDb({ history_id: "1", mailbox_email: MAILBOX, consecutive_failures: 0, messages_ingested: 0 });
    const gmail = fakeGmail({ "/history?": 404 });
    const r = await syncOrgMailbox(db.client, "org-1", { fetchImpl: gmail.fetchImpl, accessToken: "tok" });
    expect(r.status).toBe("skipped");
    expect(db.saved.at(-1)).toMatchObject({ history_id: null, status: "pending" });
  });

  it("asks for a reconnect when the grant lacks the read scope", async () => {
    const db = makeDb({ history_id: "500", mailbox_email: MAILBOX, consecutive_failures: 2, messages_ingested: 0 });
    const gmail = fakeGmail({ "/history?": 403 });
    const r = await syncOrgMailbox(db.client, "org-1", { fetchImpl: gmail.fetchImpl, accessToken: "tok" });
    expect(r.status).toBe("needs_reconnect");
    expect(db.saved.at(-1)).toMatchObject({ status: "needs_reconnect", consecutive_failures: 3 });
  });

  it("asks for a reconnect when there is no usable grant at all", async () => {
    const db = makeDb(null);
    const r = await syncOrgMailbox(db.client, "org-1", { accessToken: null });
    expect(r.status).toBe("needs_reconnect");
  });
});

describe("isMailboxDue", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("is due when never synced, or after the interval", () => {
    expect(isMailboxDue(null, now)).toBe(true);
    expect(isMailboxDue({ last_synced_at: "2026-10-02T11:00:00Z", consecutive_failures: 0 }, now)).toBe(true);
    expect(isMailboxDue({ last_synced_at: "2026-10-02T11:30:00Z", consecutive_failures: 0 }, now)).toBe(false);
  });
  it("backs off a failing mailbox", () => {
    expect(isMailboxDue({ last_synced_at: "2026-10-02T11:00:00Z", consecutive_failures: 3 }, now)).toBe(false);
  });
});
