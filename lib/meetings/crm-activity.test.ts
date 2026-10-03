// lib/meetings/crm-activity.test.ts
// The rules that decide whose permanent record a meeting lands on.
//
// This is the file that matters most in the change. A wrong link writes one
// person's meeting onto another person's CRM record, org-wide, and nothing
// downstream can tell it was wrong. "Exact email only" was a decision, and the
// near-miss cases below are what keeps it a decision rather than a comment
// somebody later reaches past.
import {
  CRM_BODY_MAX,
  NO_REPORT_BODY,
  meetingActivities,
  meetingBody,
  normalizeEmail,
  reportUrl,
  reportUrlFromMetadata,
  type CrmMeetingInput,
} from "./crm-activity";

const MEETING = {
  id: "m1",
  roomCode: "abc-def-gh",
  title: "Dunbar follow-up",
  startedAt: "2026-09-23T14:00:00.000Z",
  scheduledAt: "2026-09-23T13:55:00.000Z",
  endedAt: "2026-09-23T14:40:00.000Z",
  durationMinutes: 40,
  hostEmail: "host@fundexecs.test",
  fromBookingLink: false,
};

const REPORT = { summary: "Walked the fund's 2026 pacing.", decisions: ["Send the LPA by Friday"] };

function input(over: Partial<CrmMeetingInput> = {}): CrmMeetingInput {
  return {
    meeting: MEETING,
    invited: [{ name: "Ana Diaz", email: "ana@acme.com" }],
    attendedEmails: ["ana@acme.com"],
    contactsByEmail: new Map([["ana@acme.com", "contact-ana"]]),
    report: REPORT,
    siteUrl: "https://app.test",
    ...over,
  };
}

describe("normalizeEmail", () => {
  it("ignores case and surrounding space, which are not differences", () => {
    expect(normalizeEmail("  Ana@Acme.COM ")).toBe("ana@acme.com");
  });

  it("refuses anything that is not one address", () => {
    for (const bad of [
      "",
      "   ",
      "ana",
      "ana@",
      "@acme.com",
      "ana@acme",
      "ana@acme.",
      "ana@.com",
      "ana@@acme.com",
      "ana@acme.com, bob@acme.com",
      "ana acme.com",
      "Ana Diaz <ana@acme.com>",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(normalizeEmail(bad as unknown)).toBe("");
    }
  });
});

describe("who a meeting is logged against", () => {
  it("logs the contact whose address was in the meeting", () => {
    const rows = meetingActivities(input());
    expect(rows).toHaveLength(1);
    expect(rows[0].contactId).toBe("contact-ana");
    expect(rows[0].activityType).toBe("meeting");
    expect(rows[0].isSystem).toBe(true);
    expect(rows[0].subject).toBe("Dunbar follow-up");
    expect(rows[0].metadata.meeting_id).toBe("m1");
    expect(rows[0].metadata.attended).toBe(true);
  });

  it("writes nothing when nobody in the meeting is a contact", () => {
    expect(meetingActivities(input({ contactsByEmail: new Map() }))).toEqual([]);
    expect(
      meetingActivities(
        input({
          invited: [{ email: "stranger@elsewhere.com" }],
          attendedEmails: ["stranger@elsewhere.com"],
        }),
      ),
    ).toEqual([]);
  });

  /**
   * The cases that hold "exact only" in place.
   *
   * Every one of these is a near miss a fuzzy matcher would link, and every one
   * would put this meeting on the wrong person's record. If somebody later
   * reaches for domain or name similarity, these fail.
   */
  it("does not match an address that merely looks like a contact's", () => {
    const contacts = new Map([["ana@acme.com", "contact-ana"]]);
    for (const nearMiss of [
      "ana@acme.co", // one character short of the domain
      "ana@acme.com.br", // a longer domain that starts the same
      "ana@sub.acme.com", // a subdomain is a different host
      "ana@acmecorp.com", // the domain without the dot
      "an@acme.com", // a shorter local part
      "anna@acme.com", // a longer local part
      "ana.diaz@acme.com", // the same person, a different address
      "bob@acme.com", // a colleague at the same company
    ]) {
      const rows = meetingActivities(
        input({
          contactsByEmail: contacts,
          invited: [{ email: nearMiss }],
          attendedEmails: [nearMiss],
        }),
      );
      expect(rows).toEqual([]);
    }
  });

  it("matches regardless of how the address was capitalised in the invite", () => {
    const rows = meetingActivities(
      input({ invited: [{ email: " ANA@Acme.com " }], attendedEmails: [] }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].contactId).toBe("contact-ana");
  });
});

describe("one meeting, one row per person", () => {
  it("does not log a contact twice for being invited twice", () => {
    const rows = meetingActivities(
      input({
        invited: [{ email: "ana@acme.com" }, { email: "ana@acme.com" }],
        attendedEmails: ["ana@acme.com"],
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it("does not log a contact twice for being invited and also turning up", () => {
    const rows = meetingActivities(input());
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.attended).toBe(true);
  });

  // A contact with two addresses in the CRM, invited at one and present at the
  // other. One meeting, and they were there.
  it("counts a contact present under a second address as having attended", () => {
    const rows = meetingActivities(
      input({
        contactsByEmail: new Map([
          ["ana@acme.com", "contact-ana"],
          ["a.diaz@acme.com", "contact-ana"],
        ]),
        invited: [{ email: "ana@acme.com" }],
        attendedEmails: ["a.diaz@acme.com"],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.attended).toBe(true);
  });

  it("logs each of several contacts once", () => {
    const rows = meetingActivities(
      input({
        contactsByEmail: new Map([
          ["ana@acme.com", "contact-ana"],
          ["bob@beta.com", "contact-bob"],
        ]),
        invited: [{ email: "ana@acme.com" }, { email: "bob@beta.com" }, { email: "ana@acme.com" }],
        attendedEmails: ["ana@acme.com"],
      }),
    );
    expect(rows.map((r) => r.contactId).sort()).toEqual(["contact-ana", "contact-bob"]);
  });
});

describe("attendance is about the person, not the meeting", () => {
  it("records a contact who was invited and never joined", () => {
    const rows = meetingActivities(input({ attendedEmails: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.attended).toBe(false);
  });

  it("records somebody who joined without being invited", () => {
    const rows = meetingActivities(input({ invited: [], attendedEmails: ["ana@acme.com"] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.attended).toBe(true);
  });
});

describe("the host", () => {
  // A host who is also in the CRM has not taken a meeting with themselves.
  it("is never logged against their own record", () => {
    const rows = meetingActivities(
      input({
        contactsByEmail: new Map([["host@fundexecs.test", "contact-host"]]),
        invited: [{ email: "host@fundexecs.test" }],
        attendedEmails: ["host@fundexecs.test"],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("is excluded however their address was written", () => {
    const rows = meetingActivities(
      input({
        meeting: { ...MEETING, hostEmail: " HOST@FundExecs.test " },
        contactsByEmail: new Map([["host@fundexecs.test", "contact-host"]]),
        invited: [{ email: "host@fundexecs.test" }],
        attendedEmails: [],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("does not stop the other people in the meeting being logged", () => {
    const rows = meetingActivities(
      input({
        contactsByEmail: new Map([
          ["host@fundexecs.test", "contact-host"],
          ["ana@acme.com", "contact-ana"],
        ]),
        invited: [{ email: "host@fundexecs.test" }, { email: "ana@acme.com" }],
        attendedEmails: ["host@fundexecs.test", "ana@acme.com"],
      }),
    );
    expect(rows.map((r) => r.contactId)).toEqual(["contact-ana"]);
  });
});

describe("when it happened", () => {
  // The column's own documentation: "When it HAPPENED, which is not when it was
  // logged." A report generated the next morning must not date the meeting to
  // the morning.
  it("is the instant the room opened, not the instant this ran", () => {
    expect(meetingActivities(input())[0].occurredAt).toBe("2026-09-23T14:00:00.000Z");
  });

  it("falls back to the scheduled time when the room was never marked started", () => {
    const rows = meetingActivities(input({ meeting: { ...MEETING, startedAt: null } }));
    expect(rows[0].occurredAt).toBe("2026-09-23T13:55:00.000Z");
  });

  it("falls back to the closing stamp when there is nothing else", () => {
    const rows = meetingActivities(
      input({ meeting: { ...MEETING, startedAt: null, scheduledAt: null } }),
    );
    expect(rows[0].occurredAt).toBe("2026-09-23T14:40:00.000Z");
  });
});

describe("what the entry says", () => {
  it("carries the summary and the decisions, and links the rest", () => {
    const rows = meetingActivities(input());
    expect(rows[0].body).toContain("Walked the fund's 2026 pacing.");
    expect(rows[0].body).toContain("- Send the LPA by Friday");
    expect(rows[0].metadata.report_url).toBe("https://app.test/meetings/abc-def-gh/report");
    expect(rows[0].metadata.has_report).toBe(true);
  });

  // Key points, action items and the transcript stay in the report. The record is
  // for seeing at a glance what happened with somebody, not a second copy.
  it("says so plainly when no report was generated", () => {
    const rows = meetingActivities(input({ report: null }));
    expect(rows[0].body).toBe(NO_REPORT_BODY);
    expect(rows[0].metadata.has_report).toBe(false);
  });

  it("says the same when a report exists but the model wrote nothing into it", () => {
    expect(meetingBody({ summary: "   ", decisions: [] })).toBe(NO_REPORT_BODY);
    expect(meetingBody({ summary: null, decisions: ["", "  "] })).toBe(NO_REPORT_BODY);
  });

  it("keeps a decision list without a summary", () => {
    expect(meetingBody({ summary: null, decisions: ["Wire on Monday"] })).toBe(
      "Decisions\n- Wire on Monday",
    );
  });

  it("cuts a long report rather than putting an hour of prose on the record", () => {
    const body = meetingBody({ summary: "x".repeat(CRM_BODY_MAX + 500), decisions: [] });
    expect(body.length).toBeLessThanOrEqual(CRM_BODY_MAX + 1);
    expect(body.endsWith("…")).toBe(true);
  });

  it("titles an untitled meeting rather than logging a blank subject", () => {
    for (const title of [null, "", "   "]) {
      expect(meetingActivities(input({ meeting: { ...MEETING, title } }))[0].subject).toBe("Meeting");
    }
  });

  it("has no report link for a meeting with no room code", () => {
    expect(reportUrl("https://app.test", null)).toBeNull();
    expect(meetingActivities(input({ meeting: { ...MEETING, roomCode: null } }))[0].metadata.report_url).toBeNull();
  });

  it("does not double the slash when the site url has a trailing one", () => {
    expect(reportUrl("https://app.test/", "abc")).toBe("https://app.test/meetings/abc/report");
  });
});

describe("direction", () => {
  it("is outbound for a meeting the host convened", () => {
    expect(meetingActivities(input())[0].direction).toBe("outbound");
  });

  it("is inbound for one that came from a public booking link", () => {
    const rows = meetingActivities(input({ meeting: { ...MEETING, fromBookingLink: true } }));
    expect(rows[0].direction).toBe("inbound");
  });
});

/**
 * Reading the report link back out of an activity's metadata.
 *
 * `metadata` is jsonb and free-form, and the contact record renders this value
 * as an href. Nothing but server code writes the column today — which is exactly
 * the kind of fact that stops being true quietly — so the value is validated on
 * the way out rather than trusted on the way in.
 */
describe("reportUrlFromMetadata", () => {
  it("links a backfilled entry to its report by room code, within the app", () => {
    expect(reportUrlFromMetadata({ room_code: "abc-123" })).toBe("/meetings/abc-123/report");
    expect(reportUrlFromMetadata({ room_code: "../x" })).toBeNull();
  });

  it("returns an ordinary report link", () => {
    expect(reportUrlFromMetadata({ report_url: "https://app.test/meetings/abc/report" })).toBe(
      "https://app.test/meetings/abc/report",
    );
    expect(reportUrlFromMetadata({ report_url: "http://localhost:3000/meetings/abc/report" })).toBe(
      "http://localhost:3000/meetings/abc/report",
    );
  });

  // The one that matters: a scheme that executes must never reach an href.
  it("refuses any scheme that is not http or https", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://app.test/abc",
    ]) {
      expect(reportUrlFromMetadata({ report_url: hostile })).toBeNull();
    }
  });

  it("refuses anything that is not an absolute url", () => {
    for (const bad of ["", "   ", "/meetings/abc/report", "meetings/abc", "not a url", "://x"]) {
      expect(reportUrlFromMetadata({ report_url: bad })).toBeNull();
    }
  });

  it("refuses metadata that carries no link, or is not metadata", () => {
    for (const bad of [null, undefined, "", 0, [], {}, { report_url: null }, { report_url: 42 }, { report_url: {} }]) {
      expect(reportUrlFromMetadata(bad)).toBeNull();
    }
  });

  it("reads the link the writer actually puts there", () => {
    const rows = meetingActivities(input());
    expect(reportUrlFromMetadata(rows[0].metadata)).toBe("https://app.test/meetings/abc-def-gh/report");
  });
});
