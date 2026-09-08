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
      "organization_id", "host_id", "attendees",
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

  it("counts the host without asking the participants table", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING });
    const loaded = await loadReportForExport(client, "abc-def", { userId: "host-1" });
    expect(loaded?.attended).toBe(true);
    expect(queries.map((q) => q.table)).toEqual(["live_meetings"]);
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

  it("does not count an anonymous caller", async () => {
    const { client, queries } = fakeClient({ meeting: MEETING });
    const loaded = await loadReportForExport(client, "abc-def");
    expect(loaded?.attended).toBe(false);
    // No user to look up, so no second query to make.
    expect(queries).toHaveLength(1);
  });
});
