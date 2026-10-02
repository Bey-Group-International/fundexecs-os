import {
  buildContactReportMarkdown,
  contactReportFilename,
  reportEntries,
  reportStats,
  type ContactReportInput,
} from "./contact-report";

const BASE: ContactReportInput = {
  contact: {
    fullName: "Ana Lopez",
    email: "ana@acme.com",
    title: "Partner",
    company: "Acme Capital",
    stage: "active_lp",
    lastActivityAt: "2026-10-01T09:00:00Z",
  },
  threads: [
    {
      id: "t1",
      channel: "gmail",
      subject: "Series B terms",
      summary: "Ana is ready to sign\nonce the side letter lands.",
      status: "open",
      unread: true,
      lastMessageAt: "2026-10-01T09:00:00Z",
      linkedBy: "address",
      messages: [
        { direction: "inbound", author: "Ana", body: "Ready to sign.", occurredAt: "2026-09-30T10:00:00Z" },
        { direction: "outbound", author: "Deals", body: "Great — **sending**.", occurredAt: "2026-10-01T09:00:00Z" },
      ],
    },
    {
      id: "t2",
      channel: "slack",
      subject: null,
      summary: null,
      status: "done",
      unread: false,
      lastMessageAt: null,
      linkedBy: "manual",
    },
  ],
  meetings: [
    {
      id: "m1",
      roomCode: "abc-def",
      title: "IC prep",
      at: "2026-09-20T15:00:00Z",
      summary: "Walked through the model.",
      decisions: ["Proceed to IC"],
      actionItems: ["Send model v3", "Book diligence call"],
      hasReport: true,
      linkedBy: "address",
    },
    {
      id: "m2",
      roomCode: null,
      title: null,
      at: "2026-09-25T15:00:00Z",
      summary: null,
      decisions: [],
      actionItems: [],
      hasReport: false,
      linkedBy: "manual",
    },
  ],
  generatedAt: "2026-10-02T12:00:00Z",
};

describe("reportEntries", () => {
  it("interleaves threads and meetings newest first, undated last", () => {
    expect(reportEntries(BASE).map((e) => (e.kind === "thread" ? e.thread.id : e.meeting.id))).toEqual([
      "t1",
      "m2",
      "m1",
      "t2",
    ]);
  });
});

describe("reportStats", () => {
  it("counts what a reader asks first", () => {
    const stats = reportStats(BASE);
    expect(stats).toMatchObject({
      threads: 2,
      meetings: 2,
      unread: 1,
      openThreads: 1,
      lastEmailAt: "2026-10-01T09:00:00Z",
      lastMeetingAt: "2026-09-25T15:00:00Z",
    });
    expect(stats.actionItems.map((a) => a.item)).toEqual(["Send model v3", "Book diligence call"]);
  });
});

describe("buildContactReportMarkdown", () => {
  const md = buildContactReportMarkdown(BASE);

  it("opens with the person and the record block", () => {
    expect(md.startsWith("# Ana Lopez — Communications Report\n")).toBe(true);
    expect(md).toContain("- **Role:** Partner, Acme Capital");
    expect(md).toContain("- **Conversations:** 2 (1 open, 1 unread)");
  });

  it("lists meeting action items with where they came from", () => {
    expect(md).toContain("- Send model v3 *(IC prep, 20 Sept 2026)*");
  });

  it("renders summaries on one line and says when there is none", () => {
    expect(md).toContain("Ana is ready to sign once the side letter lands.");
    expect(md).toContain("No summary was available for this conversation.");
    expect(md).toContain("### Undated — Slack: (no subject)");
    expect(md).toContain("*Closed · linked by hand*");
  });

  it("states an unreadable meeting report rather than omitting the meeting", () => {
    expect(md).toContain("### 25 Sept 2026 — Meeting: Meeting");
    expect(md).toContain("No report is available for this meeting to you.");
    expect(md).toContain("1. Proceed to IC");
    expect(md).toContain("Reference: ABC-DEF");
  });

  it("leaves messages out unless asked", () => {
    expect(md).not.toContain("Ready to sign.");
    const full = buildContactReportMarkdown(BASE, { includeMessages: true });
    expect(full).toContain("**← Ana**");
    // Quoted, so a message's own markdown cannot restructure the document.
    expect(full).toContain("> Great — **sending**.");
    expect(full).toContain("most recent messages reproduced");
  });

  it("drops the heading for renderers that draw the title", () => {
    expect(buildContactReportMarkdown(BASE, { titleHeading: false }).startsWith("## Relationship Record")).toBe(true);
  });

  it("says plainly when nothing is linked", () => {
    const empty = buildContactReportMarkdown({ ...BASE, threads: [], meetings: [] });
    expect(empty).toContain("No conversations or meetings are linked to this person yet.");
    expect(empty).not.toContain("## Action Items From Meetings");
  });
});

describe("contactReportFilename", () => {
  it("slugs the name and dates the file", () => {
    expect(contactReportFilename("Ana López", "2026-10-02T12:00:00Z", "pdf")).toBe(
      "ana-lopez-communications-2026-10-02.pdf",
    );
    expect(contactReportFilename("", "bad", "md")).toBe("contact-communications.md");
  });
});
