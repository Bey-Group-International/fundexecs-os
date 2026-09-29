// Searching the meeting log, over HTTP.
//
// Two of these tests are the reason this route exists rather than the browser
// filtering what it was sent:
//
//   the response carries NO prose, because shipping it is the thing being
//   stopped — the list draws a line per meeting and fetches sentences per open
//   row;
//   and a meeting that has not happened yet is not a result, because the list
//   applies that same rule and a hit the list cannot show is the only place that
//   meeting appears in the product.

let auth: { ok: boolean; ctx?: { orgId: string; userId: string }; status?: number; error?: string } = {
  ok: true,
  ctx: { orgId: "org-1", userId: "user-1" },
};

jest.mock("@/lib/auth", () => ({
  requireOrgContext: async () => auth,
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({}),
}));

let searched: { query: string; orgId: string; userId: string } | null = null;
let found: {
  rows: Array<Record<string, unknown>>;
  scanned: number;
  bounded: boolean;
} = { rows: [], scanned: 0, bounded: false };

jest.mock("@/lib/meetings/meeting-log.server", () => ({
  searchMeetingLog: async (_supabase: unknown, orgId: string, userId: string, query: string) => {
    searched = { orgId, userId, query };
    return found;
  },
}));

import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { GET } from "./route";

const HOUR = 3_600_000;

/** A row as the loader hands one back. */
function row(over: {
  id?: string;
  title?: string;
  status?: string;
  scheduled_at?: string | null;
  ended_at?: string | null;
  attended?: boolean;
  hit?: unknown;
} = {}) {
  return {
    meeting: {
      id: over.id ?? "m1",
      room_code: "abc-123",
      title: over.title ?? "Dunbar Capital — Series B",
      created_at: new Date(Date.now() - 48 * HOUR).toISOString(),
      started_at: over.ended_at === null ? null : new Date(Date.now() - 26 * HOUR).toISOString(),
      ended_at: over.ended_at === undefined ? new Date(Date.now() - 25 * HOUR).toISOString() : over.ended_at,
      scheduled_at: over.scheduled_at ?? null,
      duration_minutes: 45,
      status: over.status ?? "ended",
      attendees: [{ name: "Ana Ruiz" }, { name: "Priya Shah" }],
      is_draft: false,
    },
    report: {
      summary: "They agreed to wire the second tranche on Friday.",
      key_points: ["Second tranche wiring"],
      action_items: ["Ana to circulate the valuation memo"],
      analysis: { decisions: ["Wire Friday subject to the memo"], sentiment: "positive" },
      has_transcript: true,
    },
    attended: over.attended ?? true,
    isHost: true,
    hit: over.hit ?? {
      reason: "transcript",
      matches: 2,
      snippet: {
        speaker: "Priya",
        parts: [
          { value: "Forty is above where we ", match: false },
          { value: "modelled", match: true },
          { value: " it.", match: false },
        ],
      },
    },
  };
}

function req(q: string) {
  return new NextRequest(`https://fundexecs.test/api/meetings/log/search?q=${encodeURIComponent(q)}`);
}

beforeEach(() => {
  clearRateLimitBucketsForTests();
  auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1" } };
  searched = null;
  found = { rows: [], scanned: 0, bounded: false };
});

describe("GET /api/meetings/log/search", () => {
  it("sends a line per meeting and not one word of its prose", async () => {
    // THE point of the route. Asserted over the serialised body rather than
    // field by field: a field added later that happens to carry a sentence would
    // pass a test written as a list of keys.
    found = { rows: [row()], scanned: 1, bounded: false };
    const res = await GET(req("modelled"));
    const text = await res.text();

    expect(text).not.toContain("wire the second tranche");
    expect(text).not.toContain("Second tranche wiring");
    expect(text).not.toContain("circulate the valuation memo");
    expect(text).not.toContain("Wire Friday subject to the memo");
    // The counts stand in for the lists, and the row still says how many.
    const body = JSON.parse(text) as { meetings: Array<Record<string, unknown>> };
    expect(body.meetings[0].counts).toEqual({ keyPoints: 1, decisions: 1, actionItems: 1 });
    expect(body.meetings[0].hasReport).toBe(true);
    expect(body.meetings[0].attendeeCount).toBe(2);
  });

  it("quotes the sentence the hit was in, which is the half a row cannot show", async () => {
    // The snippet is words that were SAID, and the reader was never shown them.
    // It is the one piece of prose the response carries, and it is carried for
    // the rows that matched rather than for all two hundred.
    found = { rows: [row()], scanned: 1, bounded: false };
    const body = (await (await GET(req("modelled"))).json()) as {
      meetings: Array<{ hit: { reason: string; matches: number; snippet: { speaker: string; parts: Array<{ value: string; match: boolean }> } } }>;
    };
    const hit = body.meetings[0].hit;
    expect(hit.reason).toBe("transcript");
    expect(hit.matches).toBe(2);
    expect(hit.snippet.speaker).toBe("Priya");
    expect(hit.snippet.parts.some((p) => p.match && p.value === "modelled")).toBe(true);
  });

  it("leaves the log's membership rule to the search, rather than keeping a copy", async () => {
    // It used to filter here as well. The rule moved into searchMeetingLog for a
    // reason that is not tidiness: only the search can see the rows it REJECTED,
    // and that count is what "in the most recent N meetings" reports. A second
    // copy here would filter the hits and leave the number describing something
    // else.
    found = { rows: [row({ id: "past" })], scanned: 7, bounded: false };
    const body = (await (await GET(req("dunbar"))).json()) as {
      meetings: Array<{ id: string }>;
      scanned: number;
    };
    expect(body.meetings.map((m) => m.id)).toEqual(["past"]);
    expect(body.scanned).toBe(7);
  });

  it("limits how often one person can start a two-hundred-transcript scan", async () => {
    // Raised by CodeRabbit's architecture pass: this reads every meeting in the
    // organisation, not just the caller's own, and any member can ask.
    found = { rows: [], scanned: 0, bounded: false };
    let last: Response | null = null;
    for (let i = 0; i < 40; i++) last = await GET(req(`dunbar ${i}`));
    expect(last!.status).toBe(429);
  });

  it("does not spend a signed-out flood against somebody's budget", async () => {
    // The limit sits after the auth gate on purpose: an unauthenticated caller
    // is refused at 401 and never touches a bucket, and there is no user id to
    // key one on anyway.
    auth = { ok: false, status: 401, error: "Not authenticated" };
    const res = await GET(req("dunbar"));
    expect(res.status).toBe(401);
  });

  it("says how far it looked, so the UI can admit the bound", async () => {
    found = { rows: [row()], scanned: 200, bounded: true };
    const body = (await (await GET(req("dunbar"))).json()) as { scanned: number; bounded: boolean };
    expect(body.scanned).toBe(200);
    expect(body.bounded).toBe(true);
  });

  it("refuses a query too short to be a search", async () => {
    // A single character matches most transcripts: the same as no filter, and a
    // great deal more reading. Refused rather than answered with everything, so
    // the client cannot mistake it for a result.
    const res = await GET(req("a"));
    expect(res.status).toBe(400);
    expect(searched).toBeNull();
  });

  it("passes the caller's own organisation and id to the search, never the query's", async () => {
    found = { rows: [], scanned: 0, bounded: false };
    await GET(req("dunbar"));
    expect(searched).toEqual({ orgId: "org-1", userId: "user-1", query: "dunbar" });
  });

  it("does not search for somebody who is not signed in", async () => {
    auth = { ok: false, status: 401, error: "Not authenticated" };
    const res = await GET(req("dunbar"));
    expect(res.status).toBe(401);
    expect(searched).toBeNull();
  });

  it("is never cached: an archive answered a minute ago is a different archive", async () => {
    found = { rows: [row()], scanned: 1, bounded: false };
    const res = await GET(req("dunbar"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
