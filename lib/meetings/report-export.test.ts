import {
  UNTITLED_MEETING,
  buildReportMarkdown,
  hasExportableReport,
  meetingDurationMinutes,
  reportExportFilename,
  type ReportExportInput,
} from "@/lib/meetings/report-export";

const base: ReportExportInput = {
  title: "Q3 LP Update",
  createdAt: "2026-09-07T14:00:00.000Z",
  startedAt: "2026-09-07T14:00:00.000Z",
  endedAt: "2026-09-07T14:32:00.000Z",
  summary: "Walked the LPs through Q3 marks.",
  keyPoints: ["NAV up 4%", "Two new commitments"],
  actionItems: ["Send the deck to Alina"],
  analysis: {
    decisions: ["Hold the close until October"],
    follow_up_draft: "Hi all,\n\nThanks for the time today.",
    next_meeting_suggestion: "Reconvene after the October close",
    sentiment: "positive",
  },
  fullTranscript: "Alina: Morning.\n\nRay: Let's start.",
};

describe("meetingDurationMinutes", () => {
  it("rounds the wall-clock length to the minute", () => {
    expect(meetingDurationMinutes(base.startedAt, base.endedAt)).toBe(32);
  });

  it("is null when the meeting never started or never ended", () => {
    expect(meetingDurationMinutes(null, base.endedAt)).toBeNull();
    expect(meetingDurationMinutes(base.startedAt, null)).toBeNull();
  });

  it("is null rather than negative when the timestamps disagree", () => {
    expect(meetingDurationMinutes(base.endedAt, base.startedAt)).toBeNull();
  });

  it("survives an unparseable timestamp", () => {
    expect(meetingDurationMinutes("not a date", base.endedAt)).toBeNull();
  });
});

describe("hasExportableReport", () => {
  it("is true once there is a summary", () => {
    expect(hasExportableReport(base)).toBe(true);
  });

  // The report page uses the same gate to show "generating", so export must
  // not hand somebody headings with nothing underneath them.
  it("is false while the report is still generating", () => {
    expect(hasExportableReport({ ...base, summary: null })).toBe(false);
    expect(hasExportableReport({ ...base, summary: "   " })).toBe(false);
  });
});

describe("buildReportMarkdown", () => {
  it("leads with the title, then date, length and sentiment", () => {
    const md = buildReportMarkdown(base);
    expect(md.startsWith("# Q3 LP Update\n")).toBe(true);
    expect(md).toContain("32 min");
    expect(md).toContain("Sentiment: positive");
  });

  it("carries every section the report page shows", () => {
    const md = buildReportMarkdown(base);
    for (const heading of [
      "## Summary", "## Key Points", "## Decisions",
      "## Action Items", "## Next Meeting", "## Follow-up Draft",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("- NAV up 4%");
    expect(md).toContain("- Hold the close until October");
    expect(md).toContain("- Send the deck to Alina");
  });

  // A heading with nothing under it reads as something having gone wrong, and
  // plenty of meetings genuinely reach no decisions.
  it("omits sections that have no content rather than printing them empty", () => {
    const md = buildReportMarkdown({
      ...base, keyPoints: [], actionItems: null, analysis: null,
    });
    expect(md).toContain("## Summary");
    expect(md).not.toContain("## Key Points");
    expect(md).not.toContain("## Decisions");
    expect(md).not.toContain("## Action Items");
    expect(md).not.toContain("## Follow-up Draft");
  });

  it("leaves the transcript out unless it was asked for", () => {
    expect(buildReportMarkdown(base)).not.toContain("## Full Transcript");
    expect(buildReportMarkdown(base, { includeTranscript: true })).toContain("## Full Transcript");
  });

  // Markdown folds consecutive lines into one paragraph, which would run every
  // speaker together the moment the transcript reached a PDF.
  it("keeps each transcript line a paragraph of its own", () => {
    const md = buildReportMarkdown(base, { includeTranscript: true });
    expect(md).toContain("Alina: Morning.\n\nRay: Let's start.");
  });

  it("asks for a transcript it does not have without emitting an empty section", () => {
    const md = buildReportMarkdown({ ...base, fullTranscript: "  " }, { includeTranscript: true });
    expect(md).not.toContain("## Full Transcript");
  });

  // Reports written before the notes were normalized can hold objects where
  // this expects strings — the same defect that once replaced the report page
  // with a React error.
  it("coerces model output that arrives as objects", () => {
    const md = buildReportMarkdown({
      ...base,
      keyPoints: [{ text: "NAV up 4%" }],
      actionItems: [{ item: "Send the deck" }],
    });
    expect(md).not.toContain("[object Object]");
    expect(md).toContain("NAV up 4%");
  });

  it("names an untitled meeting rather than emitting a bare heading", () => {
    expect(buildReportMarkdown({ ...base, title: null })).toContain(`# ${UNTITLED_MEETING}`);
    expect(buildReportMarkdown({ ...base, title: "   " })).toContain(`# ${UNTITLED_MEETING}`);
  });

  it("drops the meta line entirely when nothing is known about the meeting", () => {
    const md = buildReportMarkdown({
      ...base, createdAt: null, startedAt: null, endedAt: null, analysis: {},
    });
    expect(md.startsWith("# Q3 LP Update\n\n## Summary")).toBe(true);
  });

  it("never leaves a run of blank lines behind an omitted section", () => {
    const md = buildReportMarkdown({ ...base, analysis: null });
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("ends with exactly one newline", () => {
    expect(buildReportMarkdown(base).endsWith("\n")).toBe(true);
    expect(buildReportMarkdown(base).endsWith("\n\n")).toBe(false);
  });
});

describe("reportExportFilename", () => {
  it("puts the title first and the date second", () => {
    expect(reportExportFilename("Q3 LP Update", base.createdAt, "pdf"))
      .toBe("q3-lp-update-2026-09-07.pdf");
  });

  it("marks a file that carries the transcript", () => {
    expect(reportExportFilename("Q3 LP Update", base.createdAt, "docx", { includeTranscript: true }))
      .toBe("q3-lp-update-2026-09-07-with-transcript.docx");
  });

  // A downloads folder is a flat namespace shared with every other app.
  it("strips characters that have no business in a filename", () => {
    expect(reportExportFilename("Q3: LP/Update?", base.createdAt, "md"))
      .toBe("q3-lpupdate-2026-09-07.md");
  });

  it("falls back to a name when the title is missing or all punctuation", () => {
    expect(reportExportFilename(null, base.createdAt, "pdf")).toBe("meeting-2026-09-07.pdf");
    expect(reportExportFilename("!!!", base.createdAt, "pdf")).toBe("meeting-2026-09-07.pdf");
  });

  it("omits the date rather than writing NaN when it is unusable", () => {
    expect(reportExportFilename("Sync", null, "html")).toBe("sync.html");
    expect(reportExportFilename("Sync", "not a date", "html")).toBe("sync.html");
  });

  it("caps a runaway title so the name stays a name", () => {
    const name = reportExportFilename("word ".repeat(60), base.createdAt, "pdf");
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("does not leave a trailing separator when the title is truncated mid-word", () => {
    expect(reportExportFilename("a".repeat(40) + " " + "b".repeat(40), base.createdAt, "pdf"))
      .not.toContain("--");
  });
});
