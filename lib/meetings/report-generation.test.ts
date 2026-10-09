/**
 * The rules every report writer shares: when a second request is the same
 * request, when a transcript is not worth a model call, who the report names,
 * when a meeting nobody ended is abandoned, and when a summary has already
 * gone out.
 */
import { NOISE_NOTE } from "@/lib/meetings/transcript-quality";
import {
  REPORT_FRESH_MS,
  STALE_MEETING_MS,
  isAbandonedMeeting,
  isFreshReport,
  lastActivityAt,
  participantNamesForReport,
  speakerNames,
  summaryAlreadySent,
  unsummarisedAnalysis,
  unsummarisedReason,
  unsummarisedReasonFor,
} from "./report-generation";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("isFreshReport", () => {
  // The room retries a lost response by posting the same transcript again. A
  // report written a moment ago is the answer to that retry, not a reason to
  // run the model twice.
  it("is true for a report written moments ago", () => {
    expect(isFreshReport(at(-30_000), NOW)).toBe(true);
    expect(isFreshReport(at(-(REPORT_FRESH_MS - 1)), NOW)).toBe(true);
  });

  it("is false once the window has passed, so a deliberate second version still runs", () => {
    expect(isFreshReport(at(-REPORT_FRESH_MS), NOW)).toBe(false);
    expect(isFreshReport(at(-3_600_000), NOW)).toBe(false);
  });

  it("is false for no report, a bad timestamp, or one from the future", () => {
    expect(isFreshReport(null, NOW)).toBe(false);
    expect(isFreshReport("not a date", NOW)).toBe(false);
    expect(isFreshReport(at(60_000), NOW)).toBe(false);
  });
});

describe("an unsummarised report", () => {
  it("is written for a silent or unusable transcript and nothing else", () => {
    expect(unsummarisedReasonFor("silent")).toBe("silent");
    expect(unsummarisedReasonFor("unusable")).toBe("unusable");
    // Degraded audio still gets summarised: the model is told what was withheld.
    expect(unsummarisedReasonFor("degraded")).toBeNull();
    expect(unsummarisedReasonFor("usable")).toBeNull();
  });

  it("round-trips the reason through the analysis blob", () => {
    const analysis = unsummarisedAnalysis("unusable");
    expect(unsummarisedReason(analysis)).toBe("unusable");
    // Every key the schema promises is still there: the log reads
    // `analysis.decisions` off every stored report.
    expect(analysis.decisions).toEqual([]);
    expect(analysis.summary).toBe("");
  });

  it("reads nothing off an ordinary report or a failed one", () => {
    expect(unsummarisedReason({ summary: "Agreed." })).toBeNull();
    expect(unsummarisedReason({ summary: "", decisions: [] })).toBeNull();
    expect(unsummarisedReason({ unsummarised: "garbage" })).toBeNull();
    expect(unsummarisedReason(null)).toBeNull();
  });
});

describe("speakerNames", () => {
  it("lists each speaker once, in order of first appearance", () => {
    expect(speakerNames("Ana: hi\nBo: hello\nAna: again\nbo: yes")).toEqual(["Ana", "Bo"]);
  });

  it("reads a confidence note as a note, not as a second person", () => {
    // "Ana (uncertain — …)" is Ana. Splitting her into two people would list
    // a participant who does not exist.
    expect(speakerNames(`Ana: hi\nAna (${NOISE_NOTE}): mumble`)).toEqual(["Ana"]);
  });

  it("drops the pre-attribution local label, which names nobody", () => {
    expect(speakerNames("You: hi\nAna: hello")).toEqual(["Ana"]);
  });

  it("is empty for prose with no speakers", () => {
    expect(speakerNames("")).toEqual([]);
    expect(speakerNames("just some text with no speaker")).toEqual([]);
  });
});

describe("participantNamesForReport", () => {
  it("names the host first, then attendance, then speakers, then the room's own list", () => {
    expect(
      participantNamesForReport({
        host: { name: "Host Person" },
        present: [{ name: "Ana" }, { name: "Guest" }],
        transcript: "Bo: hello\nAna: hi",
        extra: ["Cy"],
      }),
    ).toEqual(["Host Person", "Ana", "Guest", "Bo", "Cy"]);
  });

  it("counts one person once however their name was capitalised", () => {
    // "ana lopez" typed at a join screen and "Ana Lopez" from the directory are
    // the same person, and listing her twice doubles the head-count.
    expect(
      participantNamesForReport({
        present: [{ name: "ana lopez" }],
        transcript: "Ana Lopez: hi",
        extra: ["ANA LOPEZ"],
      }),
    ).toEqual(["ana lopez"]);
  });

  it("never names the invite list", () => {
    // The function does not take one, which is the point: an invitee who never
    // joined is not a participant.
    expect(participantNamesForReport({})).toEqual([]);
  });

  it("drops blanks rather than listing an empty chip", () => {
    expect(participantNamesForReport({ host: { name: "  " }, present: [{ name: "" }], extra: [" "] })).toEqual([]);
  });
});

describe("a meeting nobody ended", () => {
  const base = {
    status: "waiting",
    scheduled_at: null,
    started_at: null,
    created_at: at(-24 * 3_600_000),
  };

  it("has no activity at all when nothing shows the room ever opened", () => {
    // A meeting booked for next week is `waiting` from the day it is created.
    // Reading created_at as activity would close it three hours later.
    expect(lastActivityAt(base)).toBeNull();
    expect(isAbandonedMeeting(base, NOW)).toBe(false);
  });

  it("takes the latest sign of life as its activity", () => {
    const meeting = {
      ...base,
      started_at: at(-5 * 3_600_000),
      lastJoinedAt: at(-4 * 3_600_000),
      lastSpokenAt: at(-2 * 3_600_000),
      lastLeftAt: at(-3 * 3_600_000),
    };
    expect(lastActivityAt(meeting)).toBe(NOW - 2 * 3_600_000);
  });

  it("is abandoned once the last sign of life is older than the ceiling", () => {
    expect(isAbandonedMeeting({ ...base, lastLeftAt: at(-STALE_MEETING_MS - 1) }, NOW)).toBe(true);
    expect(isAbandonedMeeting({ ...base, lastLeftAt: at(-STALE_MEETING_MS + 60_000) }, NOW)).toBe(false);
  });

  it("counts an active room as alive from its creation, even with nothing else written", () => {
    expect(isAbandonedMeeting({ ...base, status: "active" }, NOW)).toBe(true);
    expect(isAbandonedMeeting({ ...base, status: "active", created_at: at(-60_000) }, NOW)).toBe(false);
  });

  it("is never abandoned while its scheduled time is still within the ceiling", () => {
    // A host who opened the room early to test their camera, then left: the
    // meeting is still an hour away, and closing it would lock everyone out.
    const early = {
      ...base,
      lastLeftAt: at(-STALE_MEETING_MS - 3_600_000),
      scheduled_at: at(3_600_000),
    };
    expect(isAbandonedMeeting(early, NOW)).toBe(false);
    expect(isAbandonedMeeting({ ...early, scheduled_at: at(-STALE_MEETING_MS - 1) }, NOW)).toBe(true);
  });

  it("is never abandoned once it has been ended", () => {
    expect(isAbandonedMeeting({ ...base, status: "ended", lastLeftAt: at(-30 * 3_600_000) }, NOW)).toBe(false);
  });
});

describe("summaryAlreadySent", () => {
  it("refuses a second press once the first send was recorded", () => {
    expect(summaryAlreadySent({ sentAt: at(-60_000) })).toBe(true);
  });

  it("lets the host resend on purpose", () => {
    expect(summaryAlreadySent({ sentAt: at(-60_000), resend: true })).toBe(false);
  });

  it("sends when nothing was ever recorded, or the record is unreadable", () => {
    expect(summaryAlreadySent({ sentAt: null })).toBe(false);
    expect(summaryAlreadySent({ sentAt: "garbage" })).toBe(false);
  });
});
