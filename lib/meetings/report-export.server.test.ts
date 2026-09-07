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
