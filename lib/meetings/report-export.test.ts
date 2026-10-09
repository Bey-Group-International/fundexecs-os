import {
  TRUNCATED_NOTE,
  UNTITLED_MEETING,
  buildReportMarkdown,
  correspondenceSection,
  hasExportableReport,
  hasReportSummary,
  meetingDurationMinutes,
  participantNames,
  rendererDrawsTitle,
  reportDate,
  reportExportFilename,
  type ReportExportInput,
} from "@/lib/meetings/report-export";
import { NOTHING_TO_SUMMARISE } from "@/lib/meetings/report-generation";

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

  // No report row and no summary: nothing has been written yet, and a caller
  // that says nothing about the row keeps the old reading.
  it("is false while the report is still generating", () => {
    expect(hasExportableReport({ ...base, summary: null })).toBe(false);
    expect(hasExportableReport({ ...base, summary: "   " })).toBe(false);
  });

  // The defect. The route writes a report row with an empty summary when the
  // analysis fails and when a call had nothing to transcribe, and that row is
  // finished: the report page renders it with the recording and the transcript
  // behind it, while every Export item on the same screen answered 409 "Report
  // not ready" — permanently, for a report that had already arrived.
  it("is true for a finished report that has no summary", () => {
    expect(hasExportableReport({ ...base, summary: "", hasReport: true })).toBe(true);
  });
});

describe("hasReportSummary", () => {
  // Distinct question, different consequence: the download is worth having
  // without a summary, an email announcing one is not.
  it("is false for a finished report with nothing in it", () => {
    expect(hasReportSummary({ ...base, summary: "", hasReport: true })).toBe(false);
    expect(hasReportSummary(base)).toBe(true);
  });
});

describe("participantNames", () => {
  // The invite list is empty for every instant meeting, so a filed record of a
  // forty-minute conversation named nobody who had it.
  it("names the room when nothing was ever on the invitation", () => {
    expect(
      participantNames({ attendees: [], present: [{ name: "Sarah Chen" }, { name: "Dana" }] }),
    ).toEqual(["Sarah Chen", "Dana"]);
  });

  it("keeps somebody who was invited and did not come", () => {
    expect(
      participantNames({ attendees: [{ name: "Priya Raman", email: "p@f.test" }], present: [] }),
    ).toEqual(["Priya Raman"]);
  });

  it("names somebody once when they were both invited and there", () => {
    // The two sources do not agree on capitalisation: one is typed into an
    // invite box, the other comes from a directory row.
    expect(
      participantNames({
        attendees: [{ name: "Sarah Chen" }],
        present: [{ name: "sarah chen" }, { name: "Walk In" }],
      }),
    ).toEqual(["Sarah Chen", "Walk In"]);
  });

  it("survives stored data of any shape", () => {
    expect(participantNames({ attendees: "nonsense", present: null })).toEqual([]);
    expect(participantNames({})).toEqual([]);
    expect(participantNames({ present: [null as never, { name: "  " }] })).toEqual([]);
  });
});

describe("buildReportMarkdown", () => {
  // A filed document has to answer "which meeting is this" before it says
  // anything about what happened in it. This used to be one interpuncted line
  // of date, length and sentiment.
  it("leads with the title, then a labelled record block", () => {
    const md = buildReportMarkdown(base);
    expect(md.startsWith("# Q3 LP Update\n")).toBe(true);
    expect(md).toContain("## Meeting Record");
    expect(md).toContain("- **Duration:** 32 minutes");
    expect(md).toContain("- **Tone:** Positive");
  });

  // Loaded by loadReportForExport since it was written, and thrown away by this
  // builder until now: every exported report was the record of a conversation
  // that did not say who had it.
  it("names who was in the meeting", () => {
    const md = buildReportMarkdown({
      ...base,
      attendees: [
        { name: "Alina Reyes", email: "alina@example.com" },
        { name: "Rae Patel" },
      ],
    });
    expect(md).toContain("- **Participants:** Alina Reyes, Rae Patel");
    // The address is an address book entry, not a participant list.
    expect(md).not.toContain("alina@example.com");
  });

  it("quotes the meeting's own reference", () => {
    const md = buildReportMarkdown({ ...base, roomCode: "abc-123" });
    expect(md).toContain("- **Reference:** ABC-123");
  });

  it("leaves out facts it does not have rather than printing empty labels", () => {
    const md = buildReportMarkdown({
      ...base, attendees: [], roomCode: null, startedAt: null, endedAt: null,
    });
    expect(md).not.toContain("**Participants:**");
    expect(md).not.toContain("**Reference:**");
    expect(md).not.toContain("**Duration:**");
  });

  // A document that leaves the building should say what produced it and from
  // what, so a reader a year later knows whether these are minutes somebody
  // wrote or a summary a model made.
  it("states its own provenance", () => {
    const md = buildReportMarkdown(base);
    expect(md).toContain("Record generated by FundExecs");
    expect(md).toContain("model-generated");
  });

  it("carries every section the report page shows", () => {
    const md = buildReportMarkdown(base);
    for (const heading of [
      "## Summary", "## Discussion", "## Decisions",
      "## Action Items", "## Next Meeting", "## Follow-up Draft",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("- NAV up 4%");
    // Numbered, because "action 3 is mine" is a sentence people say in the
    // meeting after this one, and they cannot say it about a bullet.
    expect(md).toContain("1. Hold the close until October");
    expect(md).toContain("1. Send the deck to Alina");
  });

  // What was decided, and what it commits somebody to, outrank the discussion
  // that produced them. The old order opened on the discussion.
  it("puts decisions and actions ahead of the discussion", () => {
    const md = buildReportMarkdown(base);
    expect(md.indexOf("## Decisions")).toBeLessThan(md.indexOf("## Discussion"));
    expect(md.indexOf("## Action Items")).toBeLessThan(md.indexOf("## Discussion"));
  });

  // A heading with nothing under it reads as something having gone wrong, and
  // plenty of meetings genuinely reach no decisions.
  it("omits sections that have no content rather than printing them empty", () => {
    const md = buildReportMarkdown({
      ...base, keyPoints: [], actionItems: null, analysis: null,
    });
    expect(md).toContain("## Summary");
    expect(md).not.toContain("## Discussion");
    expect(md).not.toContain("## Decisions");
    expect(md).not.toContain("## Action Items");
    expect(md).not.toContain("## Follow-up Draft");
  });

  it("leaves the transcript out unless it was asked for", () => {
    expect(buildReportMarkdown(base)).not.toContain("## Transcript");
    expect(buildReportMarkdown(base, { includeTranscript: true })).toContain("## Transcript");
  });

  // The exported file used to get the raw stored block, with each speaker's
  // name glued to the front of their own line. The report PAGE has rendered the
  // same text as speaker turns all along; this is the same parser, so the
  // document somebody files matches the page they read.
  it("renders the transcript as speaker turns", () => {
    const md = buildReportMarkdown(base, { includeTranscript: true });
    expect(md).toContain("**Alina**");
    expect(md).toContain("**Ray**");
    expect(md).not.toContain("Alina: Morning.");
  });

  it("falls back to plain paragraphs for a transcript it cannot parse", () => {
    const md = buildReportMarkdown(
      { ...base, fullTranscript: "no speakers here.\nnor here." },
      { includeTranscript: true },
    );
    expect(md).toContain("## Transcript");
    expect(md).toContain("no speakers here.");
  });

  it("asks for a transcript it does not have without emitting an empty section", () => {
    const md = buildReportMarkdown({ ...base, fullTranscript: "  " }, { includeTranscript: true });
    expect(md).not.toContain("## Transcript");
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

  it("omits the heading when the renderer will draw the title itself", () => {
    const md = buildReportMarkdown(base, { titleHeading: false });
    expect(md).not.toContain("# Q3 LP Update");
    // Everything else still arrives, starting with the record block.
    expect(md).toContain("## Meeting Record");
    expect(md).toContain("- **Tone:** Positive");
    expect(md).toContain("## Summary");
  });

  it("keeps the heading by default, for the renderers that draw nothing", () => {
    expect(buildReportMarkdown(base, { titleHeading: true })).toContain("# Q3 LP Update");
    expect(buildReportMarkdown(base)).toContain("# Q3 LP Update");
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

describe("rendererDrawsTitle", () => {
  // Getting this backwards prints the meeting's name twice, one line under the
  // other — which is exactly what happened until a generated PDF was read.
  it("is true for the renderers that draw the title on the page", () => {
    expect(rendererDrawsTitle("rtf")).toBe(true);
    expect(rendererDrawsTitle("docx")).toBe(true);
    expect(rendererDrawsTitle("pdf")).toBe(true);
  });

  it("is false for the ones that do not", () => {
    expect(rendererDrawsTitle("html")).toBe(false);
    expect(rendererDrawsTitle("md")).toBe(false);
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

describe("the recording block", () => {
  const BASE = {
    title: "Series B sync",
    createdAt: "2026-09-17T10:00:00.000Z",
    startedAt: null,
    endedAt: null,
    summary: "We agreed terms.",
    keyPoints: [],
    actionItems: [],
    analysis: null,
    fullTranscript: null,
  };

  it("names the recording, its length and when it goes", () => {
    const md = buildReportMarkdown({
      ...BASE,
      recording: {
        url: "https://app.test/api/meetings/m1/recording/r1/stream",
        expiresAt: "2026-12-16T10:00:00.000Z",
        durationSeconds: 3_600,
      },
    });
    expect(md).toContain("## Recording");
    expect(md).toContain("https://app.test/api/meetings/m1/recording/r1/stream");
    expect(md).toContain("60 minutes");
    // A document that mentions a video without saying it is being deleted
    // invites somebody to rely on a link that will stop working.
    expect(md).toMatch(/Available until/);
  });

  // Most meetings are not recorded, and a "Recording" heading over the words
  // "not recorded" would be on the majority of exports.
  it("says nothing at all when there is no recording", () => {
    expect(buildReportMarkdown({ ...BASE, recording: null })).not.toContain("## Recording");
    expect(buildReportMarkdown(BASE)).not.toContain("## Recording");
  });

  it("omits a length it does not know rather than printing zero", () => {
    const md = buildReportMarkdown({
      ...BASE,
      recording: { url: "https://app.test/x", expiresAt: null, durationSeconds: null },
    });
    expect(md).toContain("## Recording");
    expect(md).not.toMatch(/Length/);
  });
});

describe("the participants fact", () => {
  it("names who was in the room, not only who was asked", () => {
    const doc = buildReportMarkdown({
      ...base,
      attendees: [],
      present: [{ name: "Sarah Chen" }, { name: "Dana (guest)" }],
    });
    expect(doc).toContain("**Participants:** Sarah Chen, Dana (guest)");
  });

  it("leaves the fact out when nobody is known either way", () => {
    expect(buildReportMarkdown({ ...base, attendees: [], present: [] })).not.toContain("Participants");
  });
});

describe("a report with no summary", () => {
  const unsummarised: ReportExportInput = { ...base, summary: "", hasReport: true };

  // A missing Summary section reads as a document that was generated wrong, and
  // sends somebody looking for a bug instead of regenerating the report.
  it("says the analysis did not complete when there are words", () => {
    const doc = buildReportMarkdown(unsummarised);
    expect(doc).toContain("## Summary");
    expect(doc).toContain("the analysis did not complete");
    expect(doc).not.toContain("nothing was transcribed");
  });

  it("says nothing was transcribed only when nothing was", () => {
    const doc = buildReportMarkdown({ ...unsummarised, fullTranscript: "" });
    expect(doc).toContain("nothing was transcribed");
  });

  // The transcript is what is worth having when the summary is missing, and the
  // export refusing to produce the file was refusing to hand it over.
  it("still carries the transcript when it was asked for", () => {
    const doc = buildReportMarkdown(unsummarised, { includeTranscript: true });
    expect(doc).toContain("## Transcript");
    expect(doc).toContain("Morning.");
  });

  it("leaves the section out entirely when no report row exists", () => {
    // Nothing has been written yet. There is no honest sentence to print.
    expect(buildReportMarkdown({ ...base, summary: "" })).not.toContain("## Summary");
  });
});

describe("the consent block", () => {
  const consent = {
    at: "2026-09-07T14:00:00.000Z",
    disclosure: "I am recording this call. Is that all right?",
    sources: ["microphone", "computer"],
  };

  // Stored so somebody can answer "should this have been recorded?" months
  // later. The exported file is the copy that survives longest, so leaving it
  // out was leaving it out of the only place it would eventually be looked for.
  it("reproduces the disclosure that was actually shown", () => {
    const doc = buildReportMarkdown({ ...base, consent });
    expect(doc).toContain("## Consent");
    expect(doc).toContain("I am recording this call. Is that all right?");
    expect(doc).toContain("Microphone and computer audio");
  });

  it("is absent for an ordinary meeting", () => {
    expect(buildReportMarkdown(base)).not.toContain("## Consent");
    expect(buildReportMarkdown({ ...base, consent: null })).not.toContain("## Consent");
  });

  it("refuses to imply consent from a row that does not carry one", () => {
    // readAcknowledgement never invents one, and a "Consent" heading over a
    // half-written row would claim something the record does not say.
    expect(buildReportMarkdown({ ...base, consent: { sources: ["microphone"] } }))
      .not.toContain("## Consent");
  });
});

describe("attendee correspondence", () => {
  const correspondence = {
    attendees: [
      {
        name: "Ana Lopez",
        email: "ana@acme.com",
        threads: [
          {
            id: "t1",
            channel: "gmail",
            subject: "Series B terms",
            status: "open",
            unread: true,
            summary: "Ready to sign.",
            lastMessageAt: "2026-09-30T10:00:00.000Z",
            fromThisMeeting: true,
            replied: false,
          },
        ],
        total: 3,
        lastContactAt: "2026-09-30T10:00:00.000Z",
        unread: 1,
      },
    ],
    untouched: [{ name: "Bo Chen", email: "bo@x.io" }],
    capped: false,
  };

  it("is left out unless the reader asked for it", () => {
    expect(buildReportMarkdown({ ...base, correspondence })).not.toContain("Correspondence With Attendees");
  });

  it("lists each attendee's threads and who the inbox has never heard from", () => {
    const md = buildReportMarkdown({ ...base, correspondence }, { includeCorrespondence: true });
    expect(md).toContain("## Correspondence With Attendees");
    expect(md).toContain("**Ana Lopez** (ana@acme.com)");
    expect(md).toContain("- Series B terms — this meeting's follow-up (");
    expect(md).toContain("— Ready to sign.");
    expect(md).toContain("- *2 more in the inbox*");
    expect(md).toContain("**No correspondence yet:** Bo Chen (bo@x.io)");
    expect(md).toContain("inbox history alongside");
  });

  it("withholds the never-heard-from line when the read was capped", () => {
    expect(correspondenceSection({ ...correspondence, capped: true })).not.toContain("No correspondence yet");
  });

  it("says nothing at all when there is nothing", () => {
    expect(correspondenceSection({ attendees: [], untouched: [], capped: false })).toBe("");
    expect(correspondenceSection(null)).toBe("");
  });
});

describe("the report's insight sections", () => {
  it("files open questions, risks, highlights and the next agenda", () => {
    const md = buildReportMarkdown({
      ...base,
      // The record really contains the highlight's words: a quote the
      // transcript cannot vouch for is dropped, not exported. See below.
      fullTranscript: "Alina: We settled at forty pre.\n\nRay: Agreed.",
      analysis: {
        ...base.analysis,
        unresolved: ["Sam: Who signs the side letter?"],
        risks: ["Counsel may not clear the MFN clause"],
        highlights: [{ point: "Terms agreed", quote: "forty pre" }],
        next_meeting_agenda: ["Side letter status", "LPAC vote"],
      },
    });
    expect(md).toContain("## Open Questions\n\n- Sam: Who signs the side letter?");
    expect(md).toContain("## Risks\n\n- Counsel may not clear the MFN clause");
    expect(md).toContain("## Highlights\n\n- Terms agreed — “forty pre”");
    expect(md).toContain("## Next Meeting Agenda\n\n1. Side letter status\n2. LPAC vote");
  });

  it("never exports a quote the transcript does not contain", () => {
    // Rendered between quotation marks, a paraphrase is invented speech in a
    // participant's mouth — in a document that gets emailed. The point stays;
    // the claim of exact words goes.
    const md = buildReportMarkdown({
      ...base,
      analysis: {
        ...base.analysis,
        highlights: [{ point: "Terms agreed", quote: "forty pre" }],
      },
    });
    expect(md).toContain("## Highlights\n\n- Terms agreed");
    expect(md).not.toContain("forty pre");
  });

  it("adds no empty headings for a report without them", () => {
    const md = buildReportMarkdown(base);
    expect(md).not.toMatch(/## (Open Questions|Risks|Highlights|Next Meeting Agenda)/);
  });
});

describe("the day the document is dated", () => {
  // The page dates a meeting by when it happened; the export dated it by when
  // the row was made, so a report booked a week ahead carried the wrong day.
  const booked = {
    ...base,
    createdAt: "2026-09-01T09:00:00.000Z",
    scheduledAt: "2026-09-07T14:00:00.000Z",
    startedAt: null,
    endedAt: null,
  };

  it("uses the start when there is one", () => {
    expect(reportDate(base)).toBe(base.startedAt);
  });

  it("falls back to the booked time, and only then to the row", () => {
    expect(reportDate(booked)).toBe("2026-09-07T14:00:00.000Z");
    expect(reportDate({ ...booked, scheduledAt: null })).toBe("2026-09-01T09:00:00.000Z");
    expect(reportDate({ ...booked, scheduledAt: null, createdAt: null })).toBeNull();
  });

  it("prints that day in the record block and in the filename", () => {
    const md = buildReportMarkdown(booked);
    expect(md).toContain("- **Date:** Monday, September 7, 2026");
    expect(md).not.toContain("September 1");
    expect(reportExportFilename(booked.title, reportDate(booked), "pdf")).toBe("q3-lp-update-2026-09-07.pdf");
  });
});

describe("what the page shows that the file used to drop", () => {
  it("files the questions put to the host, numbered so they can be answered by number", () => {
    const md = buildReportMarkdown({
      ...base,
      analysis: { ...base.analysis, open_questions: ["Did Jane commit to the re-up?", "Which Friday?"] },
    });
    expect(md).toContain("## Questions For The Host\n\n1. Did Jane commit to the re-up?\n2. Which Friday?");
    // Before the decisions they qualify.
    expect(md.indexOf("## Questions For The Host")).toBeLessThan(md.indexOf("## Decisions"));
  });

  it("adds no heading when the host was asked nothing", () => {
    expect(buildReportMarkdown(base)).not.toContain("Questions For The Host");
  });

  it("says when the analysis was cut short, before the summary it qualifies", () => {
    const md = buildReportMarkdown({ ...base, analysis: { ...base.analysis, report_truncated: true } });
    expect(md).toContain(`## Note\n\n${TRUNCATED_NOTE}`);
    expect(md.indexOf("## Note")).toBeLessThan(md.indexOf("## Summary"));
    expect(buildReportMarkdown(base)).not.toContain("## Note");
  });

  it("says there was nothing to summarise for a report filed that way on purpose", () => {
    const md = buildReportMarkdown({
      ...base,
      summary: "",
      hasReport: true,
      fullTranscript: "Gary (uncertain — not recognised reliably): garble",
      analysis: { unsummarised: "unusable" },
    });
    expect(md).toContain(`*${NOTHING_TO_SUMMARISE}*`);
    // Not the advice for a failed analysis: regenerating this one changes nothing.
    expect(md).not.toContain("did not complete");
  });
});
