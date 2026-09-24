// The select strings the export reads through.
//
// They cannot be assembled at runtime — supabase-js parses the select string at
// the type level to check the columns exist, and a string it cannot read as a
// literal takes those checks with it. So the two are written out, and this
// holds them to the one rule that matters: they differ by the transcript and
// nothing else.

import { REPORT_SELECTS } from "@/lib/meetings/report-export.server";

const TRANSCRIPT_COLUMN = "full_transcript";

describe("REPORT_SELECTS", () => {
  it("reads the transcript only when it was asked for", () => {
    expect(REPORT_SELECTS.withTranscript).toContain(TRANSCRIPT_COLUMN);
    expect(REPORT_SELECTS.summary).not.toContain(TRANSCRIPT_COLUMN);
  });

  // Written out twice, so the risk is that one gains a column the other never
  // does and an export quietly loses a section depending on a checkbox.
  it("differs by that column and nothing else", () => {
    expect(REPORT_SELECTS.withTranscript.replace(`, ${TRANSCRIPT_COLUMN}`, ""))
      .toBe(REPORT_SELECTS.summary);
  });

  it("embeds the report rather than fetching it separately", () => {
    for (const select of Object.values(REPORT_SELECTS)) {
      expect(select).toContain("live_meeting_reports(");
    }
  });

  it("asks for every meeting field the export puts in the document", () => {
    for (const column of [
      "room_code", "title", "created_at", "started_at", "ended_at",
      "organization_id", "host_id", "attendees", "kind", "recording_consent",
    ]) {
      expect(REPORT_SELECTS.summary).toContain(column);
    }
  });

  it("asks for every report field the document is built from", () => {
    for (const column of ["summary", "key_points", "action_items", "analysis"]) {
      expect(REPORT_SELECTS.summary).toContain(column);
    }
  });
});

// ── Attendance ─────────────────────────────────────────────────────────────
//
// Reports are attendees-only, and RLS is what enforces it — but RLS enforces it
// by emptying the report, which is indistinguishable from a report still being
// written. `attended` is what lets the routes tell a non-attendee "not yours"
// instead of "not ready yet", so it is worth pinning here rather than only in
// the routes that read it.

import { loadReportForExport } from "@/lib/meetings/report-export.server";

type Query = { table: string; filters: Array<[string, unknown]> };

/**
 * A supabase client just real enough for this function: every builder method
 * returns the builder, and `maybeSingle` hands back whatever the table was
 * seeded with. The queries it saw are recorded so a test can assert that the
 * participant lookup was skipped rather than merely that it returned nothing.
 */
function fakeClient(rows: { meeting?: unknown; participant?: unknown }) {
  const queries: Query[] = [];
  const from = (table: string) => {
    const query: Query = { table, filters: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.eq = (column: string, value: unknown) => { query.filters.push([column, value]); return builder; };
    builder.maybeSingle = async () => ({
      data: table === "live_meetings" ? rows.meeting ?? null : rows.participant ?? null,
    });
    return builder;
  };
  return { client: { from } as never, queries };
}

const MEETING = {
  id: "m1",
  room_code: "abc-def",
  title: "Q3 review",
  host_id: "host-1",
  organization_id: "org-1",
  created_at: "2026-09-01T10:00:00.000Z",
  started_at: null,
  ended_at: null,
  attendees: [],
  live_meeting_reports: [{ summary: "went well", key_points: [], action_items: [], analysis: null }],
};

describe("loadReportForExport attendance", () => {
  it("returns null for a meeting the caller cannot see", async () => {
    const { client } = fakeClient({ meeting: null });
    expect(await loadReportForExport(client, "abc-def", { userId: "u1" })).toBeNull();
  });

  it("counts the host without asking whether they attended", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "host-1" });
    expect(loaded?.attended).toBe(true);
    // The claim is about the attendance CHECK, which is the participants query
    // filtered by user_id. An attendee's export also reads that table for who
    // else was in the room — a different question, asked for the document and
    // for who its email goes to, and not what this test is pinning.
    const attendanceChecks = queries.filter(
      (q) => q.table === "live_meeting_participants" && q.filters.some(([c]) => c === "user_id"),
    );
    expect(attendanceChecks).toEqual([]);
  });

  it("counts a member with an attendance row", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING, participant: { meeting_id: "m1" } });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "u2" });
    expect(loaded?.attended).toBe(true);
    expect(queries[1]).toEqual({
      table: "live_meeting_participants",
      filters: [["meeting_id", "m1"], ["user_id", "u2"]],
    });
  });

  it("does not count a co-member who was never in the room", async () => {
    const { client } = fakeClient({ meeting: MEETING, participant: null });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "u2" });
    expect(loaded?.attended).toBe(false);
  });

  // What the gate is actually for: the blocks a document carries are read only
  // once the caller is known to have been in the room. RLS would refuse them
  // anyway — but a caller who is about to be told the report is not theirs has
  // no business costing the queries.
  it("reads the chat for someone who was there", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING });
    await loadReportForExport(client, "abc-def", { userId: "host-1" });
    expect(queries.map((q) => q.table)).toContain("live_meeting_chat");
  });

  it("does not read the chat for a co-member who was never in the room", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING, participant: null });
    await loadReportForExport(client, "abc-def", { userId: "u2" });
    expect(queries.map((q) => q.table)).not.toContain("live_meeting_chat");
  });

  it("does not count an anonymous caller", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING });
    const loaded = await loadReportForExport(client, "abc-def");
    expect(loaded?.attended).toBe(false);
    // No user to look up, and nothing an anonymous caller may read: neither the
    // participant lookup nor the attendee-only blocks are fetched.
    expect(queries.map((q) => q.table)).toEqual(["live_meetings"]);
  });
});

// ── What the loader tells the export about the report row ──────────────────

describe("loadReportForExport report presence", () => {
  it("reports a row with an empty summary as a report that exists", async () => {
    // The distinction the export gate now turns on: a row the model wrote
    // nothing into is FINISHED, and calling it "not ready" made every Export
    // item on a readable report page answer 409 forever.
    const { client } = fakeClient({
      meeting: {
        ...MEETING,
        live_meeting_reports: [{ summary: "", key_points: [], action_items: [], analysis: null }],
      },
    });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "host-1" });
    expect(loaded?.hasReport).toBe(true);
    expect(loaded?.summary).toBe("");
  });

  it("reports no row when the report has not been written", async () => {
    const { client } = fakeClient({ meeting: { ...MEETING, live_meeting_reports: [] } });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "host-1" });
    expect(loaded?.hasReport).toBe(false);
  });

  it("reads who was in the room for somebody who was there", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING });
    await loadReportForExport(client, "abc-def", { userId: "host-1" });
    // Not the attendance check — a read of the whole room, which is what both
    // the document's participant list and the summary email are built from.
    const roomReads = queries.filter(
      (q) => q.table === "live_meeting_participants" && !q.filters.some(([c]) => c === "user_id"),
    );
    expect(roomReads).toHaveLength(1);
  });

  it("does not read the room for a co-member who was never in it", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING, participant: null });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "u2" });
    expect(loaded?.present).toEqual([]);
    const roomReads = queries.filter(
      (q) => q.table === "live_meeting_participants" && !q.filters.some(([c]) => c === "user_id"),
    );
    expect(roomReads).toEqual([]);
  });

  it("carries the meeting's kind and stored consent through", async () => {
    const consent = { at: "2026-09-01T10:00:00.000Z", disclosure: "Recording.", sources: ["microphone"] };
    const { client } = fakeClient({ meeting: { ...MEETING, kind: "one_way", recording_consent: consent } });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "host-1" });
    expect(loaded?.kind).toBe("one_way");
    expect(loaded?.consent).toEqual(consent);
  });
});
