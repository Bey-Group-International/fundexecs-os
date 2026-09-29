// lib/meetings/report-page.server.test.ts
// The one server read that replaced seven browser round trips.
//
// Two assertions here are about SHAPE rather than output, and they are the ones
// that would notice this change quietly regressing:
//
//   - the reads that do not depend on each other run together, not in sequence.
//     A loader that awaits five things one at a time still returns the right
//     answer, so nothing else in this file would fail.
//   - a non-attendee gets no transcript, no chat and no recordings in the
//     payload. RLS already returns nothing for them, but a payload is serialized
//     into the HTML, and "the database would have refused" is not a reason to
//     put a meeting's contents in a page that says the reader may not read it.
import { loadReportPage } from "./report-page.server";
import { REPORT_WAIT_LIMIT_MS } from "./attendance";

interface Rows {
  meeting?: Record<string, unknown> | null;
  report?: Record<string, unknown> | null;
  attended?: boolean;
  recordings?: Array<Record<string, unknown>>;
  chat?: Array<Record<string, unknown>>;
  transcript?: Array<Record<string, unknown>>;
  viewer?: { id: string } | null;
}

const MEETING = {
  id: "m1",
  host_id: "host-1",
  title: "Dunbar follow-up",
  created_at: "2026-09-23T13:00:00.000Z",
  started_at: "2026-09-23T14:00:00.000Z",
  ended_at: "2026-09-23T14:40:00.000Z",
  scheduled_at: null,
  kind: "meeting",
  recording_consent: null,
};

const NOW = Date.parse("2026-09-23T14:41:00.000Z");

/**
 * A Supabase stand-in that records WHEN each read started, so the test can see
 * whether independent reads overlapped or queued.
 */
function client(rows: Rows = {}) {
  const started: string[] = [];
  const settled: string[] = [];
  let tick = 0;
  /** Resolves on a later microtask, so a sequential loader visibly serializes. */
  const later = async <T>(table: string, value: T): Promise<T> => {
    started.push(table);
    await Promise.resolve();
    await Promise.resolve();
    settled.push(table);
    tick += 1;
    return value;
  };

  const api = {
    auth: {
      getUser: async () => {
        started.push("auth");
        return { data: { user: "viewer" in rows ? rows.viewer : { id: "host-1" } } };
      },
    },
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          // `in`, not `??`: a test that passes `meeting: null` means "no such
          // room", and a nullish fallback would quietly hand it the fixture.
          if (table === "live_meetings") {
            return later(table, { data: "meeting" in rows ? rows.meeting : MEETING });
          }
          if (table === "live_meeting_reports") return later(table, { data: rows.report ?? null });
          if (table === "live_meeting_participants") {
            return later(table, { data: rows.attended === false ? null : { meeting_id: "m1" } });
          }
          return later(table, { data: null });
        },
        range: () => later(table, { data: rows.transcript ?? [], error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          // The two reads with no terminal call: recordings and chat are awaited
          // as the builder itself.
          if (table === "live_meeting_recordings") {
            return later(table, { data: rows.recordings ?? [] }).then(resolve);
          }
          return later(table, { data: rows.chat ?? [] }).then(resolve);
        },
      };
      return chain;
    },
  };
  return { api, started, settled, ticks: () => tick };
}

describe("loadReportPage", () => {
  it("returns one payload with every part the page renders", async () => {
    const { api } = client({
      report: {
        summary: "They agreed to wire on Friday.",
        key_points: ["Timing"],
        action_items: [],
        analysis: {},
        full_transcript: "Ana: Friday.",
      },
      recordings: [{ id: "r1", status: "complete", deleted_at: null }],
      chat: [{ id: "c1", author_id: "u1", author_name: "Ana", body: "hi", ts: "2026-09-23T14:05:00.000Z" }],
      transcript: [{ speaker: "Ana", text: "Friday.", ts: "2026-09-23T14:05:00.000Z" }],
    });

    const data = await loadReportPage(api as never, "abc-def-gh", NOW);

    expect(data.state).toBe("ready");
    expect(data.meeting?.id).toBe("m1");
    expect(data.report?.summary).toBe("They agreed to wire on Friday.");
    expect(data.viewerId).toBe("host-1");
    expect(data.isHost).toBe(true);
    expect(data.attended).toBe(true);
    expect(data.recordings).toHaveLength(1);
    // Read back as messages by the loader, not as rows for the panel to shape:
    // the guest-identity rule lives in storedChatMessages, where it is tested.
    expect(data.chat).toEqual([
      {
        id: "c1",
        from: "u1",
        displayName: "Ana",
        text: "hi",
        ts: Date.parse("2026-09-23T14:05:00.000Z"),
      },
    ]);
    expect(data.cueRows).toHaveLength(1);
  });

  it("runs the reads that do not depend on each other together", async () => {
    // The point of the change. Five reads hang off the meeting's id and none of
    // them needs another's answer, so they start together. A loader that awaited
    // them one at a time would return exactly the same payload — which is why
    // this is asserted on the ORDER, not the result.
    const { api, started } = client({ report: { summary: "x", full_transcript: "y" } });

    await loadReportPage(api as never, "abc-def-gh", NOW);

    // Wave one: the viewer and the meeting, before anything that needs the id.
    expect(started.slice(0, 2).sort()).toEqual(["auth", "live_meetings"]);

    // Wave two: all five began before any of them had to finish.
    const waveTwo = started.slice(2);
    expect(waveTwo.sort()).toEqual([
      "live_meeting_chat",
      "live_meeting_participants",
      "live_meeting_recordings",
      "live_meeting_reports",
      "live_meeting_transcripts",
    ]);
  });

  it("does not ask for the meeting's contents before it knows the meeting exists", async () => {
    // The one dependency that IS real: everything else is keyed by meeting id.
    const { api, started } = client({ meeting: null });

    const data = await loadReportPage(api as never, "no-such-room", NOW);

    expect(data.state).toBe("missing");
    expect(data.meeting).toBeNull();
    expect(started).toEqual(["auth", "live_meetings"]);
  });

  it("still reports who was asking when the meeting is missing", async () => {
    // So a "not found" page can still tell a signed-in reader from an anonymous
    // one without a second round trip.
    const { api } = client({ meeting: null });
    expect((await loadReportPage(api as never, "nope", NOW)).viewerId).toBe("host-1");
  });

  it("withholds the meeting's contents from someone who was not there", async () => {
    // RLS returns nothing for them anyway. This is about the payload: it is
    // serialized into the HTML, so "the database would have refused" is not a
    // reason to ship a transcript to a page that says the reader may not read it.
    const { api } = client({
      viewer: { id: "outsider" },
      attended: false,
      report: { summary: "secret", full_transcript: "every word" },
      recordings: [{ id: "r1", status: "complete", deleted_at: null }],
      chat: [{ id: "c1", author_id: "u1", author_name: "Ana", body: "private", ts: "t" }],
      transcript: [{ speaker: "Ana", text: "private", ts: "t" }],
    });

    const data = await loadReportPage(api as never, "abc-def-gh", NOW);

    expect(data.state).toBe("forbidden");
    expect(data.recordings).toEqual([]);
    expect(data.chat).toEqual([]);
    expect(data.cueRows).toEqual([]);
  });

  it("decides forbidden before generating, so a non-attendee is told rather than left waiting", async () => {
    // The ordering defect this page has been fixed for once already: under RLS a
    // non-attendee's report read is empty, which is exactly what a report still
    // being written looks like.
    const { api } = client({ viewer: { id: "outsider" }, attended: false, report: null });
    expect((await loadReportPage(api as never, "abc-def-gh", NOW)).state).toBe("forbidden");
  });

  it("is generating while the report is genuinely new", async () => {
    const { api } = client({ report: null });
    expect((await loadReportPage(api as never, "abc-def-gh", NOW)).state).toBe("generating");
  });

  it("is stalled once the MEETING has been over too long, not the visit", async () => {
    // The rule that changed crossing to the server. A week-old report with no
    // row is not "generating" to somebody opening it for the first time.
    const { api } = client({ report: null });
    const late = Date.parse("2026-09-23T14:40:00.000Z") + REPORT_WAIT_LIMIT_MS;
    expect((await loadReportPage(api as never, "abc-def-gh", late)).state).toBe("stalled");
  });

  it("calls a report row with no summary finished, not pending", async () => {
    // A row the model could not write is done. Conflating it with "pending" is
    // what put a permanent spinner over readable recordings and transcripts.
    const { api } = client({ report: { summary: "", full_transcript: "Ana: Friday." } });
    expect((await loadReportPage(api as never, "abc-def-gh", NOW)).state).toBe("unsummarised");
  });

  it("treats a whitespace-only summary as no summary", async () => {
    const { api } = client({ report: { summary: "   \n", full_transcript: "x" } });
    expect((await loadReportPage(api as never, "abc-def-gh", NOW)).state).toBe("unsummarised");
  });

  it("does not claim the reader is the host when nobody is signed in", async () => {
    const { api } = client({ viewer: null, report: { summary: "x" } });
    const data = await loadReportPage(api as never, "abc-def-gh", NOW);
    expect(data.viewerId).toBeNull();
    expect(data.isHost).toBe(false);
  });

  it("skips the attendance read entirely with no viewer to ask about", async () => {
    // .eq("user_id", null) is not a question worth sending.
    const { api, started } = client({ viewer: null, report: { summary: "x" } });
    await loadReportPage(api as never, "abc-def-gh", NOW);
    expect(started).not.toContain("live_meeting_participants");
  });

  it("keeps the transcript's timestamps optional, not fatal", async () => {
    // A failed cue read costs the ability to drive and follow the recording. The
    // transcript still renders from full_transcript, so it must not take the
    // page down with it.
    const { api } = client({ report: { summary: "x", full_transcript: "Ana: Friday." } });
    const broken = {
      ...api,
      from(table: string) {
        if (table !== "live_meeting_transcripts") return api.from(table);
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          range: async () => {
            throw new Error("network");
          },
        };
        return chain;
      },
    };

    const data = await loadReportPage(broken as never, "abc-def-gh", NOW);

    expect(data.state).toBe("ready");
    expect(data.cueRows).toEqual([]);
    expect(data.report?.full_transcript).toBe("Ana: Friday.");
  });
});
