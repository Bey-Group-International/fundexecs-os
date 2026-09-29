/**
 * The shared archive rules.
 *
 * Two of these tests are the reason the engine is shared at all:
 *
 *   a search reports when it stopped looking, because "No matches" over a
 *   bounded scan is a false statement and the naive count makes it;
 *   and a transcript hit is distinguishable from a title hit, because one is a
 *   sentence the reader has not seen and the other is the row they are reading.
 */

import {
  LIST_PAGE,
  SEARCH_SCAN,
  matchesMetadata,
  searchSession,
  searchSummary,
  type ArchivedSession,
  type SessionMetadata,
} from "./session-archive";
import { MIN_QUERY } from "./transcript-search";

const session = (over: Partial<ArchivedSession> = {}): ArchivedSession => ({
  id: "m1",
  roomCode: "abc-def-gh",
  title: "Dunbar Capital — Series B follow-up",
  at: "2026-09-23T14:00:00.000Z",
  attendeeNames: ["Ana Ruiz", "Priya Shah"],
  durationMinutes: 42,
  durationSeconds: null,
  hasReport: true,
  ...over,
});

const meta = (over: Partial<SessionMetadata> = {}): SessionMetadata => ({
  title: "Dunbar Capital — Series B follow-up",
  summary: "They agreed to wire the second tranche on Friday.",
  keyPoints: ["Second tranche wiring"],
  decisions: ["Wire Friday subject to the memo"],
  actionItems: ["Ana to circulate the valuation memo"],
  attendeeNames: ["Ana Ruiz", "Priya Shah"],
  ...over,
});

const TRANSCRIPT = [
  "Ana: The valuation came in at forty.",
  "Priya: Forty is above where we modelled it.",
  "Ana: Agreed — I will send the valuation memo on Friday.",
].join("\n");

describe("matchesMetadata", () => {
  it("matches on the title", () => {
    expect(matchesMetadata(meta(), "dunbar")).toBe(true);
  });

  it("matches on an attendee, which is how people look for a meeting", () => {
    expect(matchesMetadata(meta(), "priya")).toBe(true);
  });

  it("matches on a decision or an action item, not only the summary", () => {
    expect(matchesMetadata(meta(), "memo")).toBe(true);
  });

  it("requires EVERY term, so a second word narrows rather than widens", () => {
    // "dunbar valuation" should mean both. Matching either turns a search into a
    // way of getting more results.
    expect(matchesMetadata(meta(), "dunbar memo")).toBe(true);
    expect(matchesMetadata(meta(), "dunbar tungsten")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(matchesMetadata(meta(), "  DUNBAR  ")).toBe(true);
  });

  it("matches everything for an empty query", () => {
    expect(matchesMetadata(meta(), "")).toBe(true);
    expect(matchesMetadata(meta(), "   ")).toBe(true);
  });

  it("does not match on words that are in neither the report nor the people", () => {
    expect(matchesMetadata(meta(), "tungsten")).toBe(false);
  });
});

describe("searchSession", () => {
  it("finds a session by what was SAID in it, which the log could not do", () => {
    // The question a log is actually for. Nothing in the title, summary,
    // decisions or attendees contains this word.
    const hit = searchSession(session(), meta({ summary: "", keyPoints: [], decisions: [], actionItems: [] }), TRANSCRIPT, "modelled");
    expect(hit).not.toBeNull();
    expect(hit!.reason).toBe("transcript");
    expect(hit!.matches).toBe(1);
    expect(hit!.snippet).not.toBeNull();
  });

  it("quotes the sentence around the hit, not just the fact of it", () => {
    const hit = searchSession(session(), meta(), TRANSCRIPT, "modelled");
    const text = (hit!.snippet!.parts ?? []).map((p) => p.value).join("");
    expect(text).toContain("above where we modelled");
    expect(hit!.snippet!.speaker).toBe("Priya");
  });

  it("marks the matched words inside the snippet", () => {
    // Parts, not markup: these are other people's words, and a renderer that
    // builds HTML from them can be made to build something else.
    const hit = searchSession(session(), meta(), TRANSCRIPT, "modelled");
    expect(hit!.snippet!.parts.some((p) => p.match)).toBe(true);
  });

  it("counts every occurrence, so a row can say how much was said about it", () => {
    const hit = searchSession(session(), meta(), TRANSCRIPT, "valuation");
    expect(hit!.matches).toBe(2);
  });

  it("still matches on metadata when there is no transcript at all", () => {
    const hit = searchSession(session(), meta(), null, "dunbar");
    expect(hit).not.toBeNull();
    expect(hit!.reason).toBe("metadata");
    expect(hit!.matches).toBe(0);
    expect(hit!.snippet).toBeNull();
  });

  it("reports a transcript hit as such even when the title matched too", () => {
    // Both are true; the transcript half is the one the reader cannot already
    // see in the row they are looking at.
    const hit = searchSession(session(), meta(), TRANSCRIPT, "valuation");
    expect(matchesMetadata(meta(), "valuation")).toBe(true);
    expect(hit!.reason).toBe("transcript");
  });

  it("is null when neither half matches", () => {
    expect(searchSession(session(), meta(), TRANSCRIPT, "tungsten")).toBeNull();
  });

  it("refuses a query too short to be a search", () => {
    // One character matches most transcripts, which is the same as no filter at
    // all but a great deal more reading.
    expect(searchSession(session(), meta(), TRANSCRIPT, "a")).toBeNull();
    expect(MIN_QUERY).toBeGreaterThan(1);
  });

  it("survives an empty transcript rather than treating it as a miss", () => {
    const hit = searchSession(session(), meta(), "   ", "dunbar");
    expect(hit).not.toBeNull();
    expect(hit!.reason).toBe("metadata");
  });

  it("carries the session's own fields through untouched", () => {
    const hit = searchSession(session({ durationSeconds: 754 }), meta(), TRANSCRIPT, "dunbar");
    expect(hit!.id).toBe("m1");
    expect(hit!.roomCode).toBe("abc-def-gh");
    expect(hit!.durationSeconds).toBe(754);
    expect(hit!.attendeeNames).toEqual(["Ana Ruiz", "Priya Shah"]);
  });
});

describe("searchSummary", () => {
  it("counts sessions when nobody is searching", () => {
    expect(searchSummary({ query: "", hits: 12, scanned: 12, bounded: false })).toBe("12 sessions");
    expect(searchSummary({ query: "", hits: 1, scanned: 1, bounded: false })).toBe("1 session");
  });

  it("says how many matched", () => {
    expect(searchSummary({ query: "dunbar", hits: 3, scanned: 40, bounded: false }))
      .toBe("3 matches for “dunbar”");
    expect(searchSummary({ query: "dunbar", hits: 1, scanned: 40, bounded: false }))
      .toBe("1 match for “dunbar”");
  });

  it("does not claim nothing matched when it only stopped looking", () => {
    // The assertion that matters. A bounded scan returning zero has not
    // established absence, and "No matches" alone says it has.
    expect(searchSummary({ query: "dunbar", hits: 0, scanned: 200, bounded: true }))
      .toBe("No matches for “dunbar” in the most recent 200 sessions");
  });

  it("admits the bound even when it DID find something", () => {
    // Because the reader may be looking for an older one, and a confident "3
    // matches" invites them to stop.
    expect(searchSummary({ query: "dunbar", hits: 3, scanned: 200, bounded: true }))
      .toBe("3 matches for “dunbar” in the most recent 200 sessions");
  });

  it("says plainly that nothing matched when it really did look at everything", () => {
    expect(searchSummary({ query: "tungsten", hits: 0, scanned: 40, bounded: false }))
      .toBe("No matches for “tungsten”");
  });
});

describe("the bounds themselves", () => {
  it("scans deeper than it lists, because searching is the reason to go back", () => {
    // A list is a page of recent history; a search is asked of the archive.
    expect(SEARCH_SCAN).toBeGreaterThan(LIST_PAGE);
  });
});
