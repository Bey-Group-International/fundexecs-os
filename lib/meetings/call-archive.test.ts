import {
  SNIPPET_AFTER,
  SNIPPET_BEFORE,
  callWhen,
  searchCall,
  snippetFor,
  type ArchivedCall,
} from "@/lib/meetings/call-archive";
import { findMatches } from "@/lib/meetings/transcript-search";
import { parseTranscript } from "@/lib/meetings/transcript-view";

const call: ArchivedCall = {
  id: "c1",
  roomCode: "abc-def-gh",
  title: "Dunbar follow-up",
  at: "2026-03-04T14:15:00.000Z",
  durationSeconds: 1820,
  summary: "Agreed the valuation range.",
  consented: true,
};

const TRANSCRIPT = [
  "Priya: What did we land on for the valuation?",
  "Tom: Forty, roughly. We can revisit the valuation next quarter if the round moves.",
].join("\n");

describe("searchCall", () => {
  it("finds a call by what was said in it", () => {
    const hit = searchCall(call, TRANSCRIPT, "valuation");
    expect(hit?.matches).toBe(2);
    expect(hit?.id).toBe("c1");
  });

  // Null rather than a zero-match hit: a caller that has to remember to check
  // a count is a caller that eventually will not.
  it("is null when the call does not mention it", () => {
    expect(searchCall(call, TRANSCRIPT, "diligence")).toBeNull();
  });

  it("does not run on a query too short to mean anything", () => {
    expect(searchCall(call, TRANSCRIPT, "v")).toBeNull();
  });

  it("survives a call with no transcript stored", () => {
    expect(searchCall(call, "", "valuation")).toBeNull();
  });
});

describe("snippetFor", () => {
  const turns = parseTranscript(TRANSCRIPT);

  it("marks the hit and keeps the words around it", () => {
    const hit = searchCall(call, TRANSCRIPT, "valuation")!;
    const marked = hit.snippet!.parts.filter((p) => p.match);
    expect(marked).toHaveLength(1);
    expect(marked[0].value).toBe("valuation");
    expect(hit.snippet!.speaker).toBe("Priya");
  });

  // "Yes, about forty" means nothing without the question above it, which is
  // the whole reason a snippet exists rather than a bare match count.
  it("carries enough context to recognise the hit", () => {
    const hit = searchCall(call, TRANSCRIPT, "Forty")!;
    const text = hit.snippet!.parts.map((p) => p.value).join("");
    expect(text).toContain("Forty");
    expect(text.length).toBeGreaterThan("Forty".length);
  });

  it("marks the cut, so a truncation does not read as a typo", () => {
    const long = `Priya: ${"a".repeat(400)} valuation ${"b".repeat(400)}`;
    const hit = searchCall(call, long, "valuation")!;
    const text = hit.snippet!.parts.map((p) => p.value).join("");
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(SNIPPET_BEFORE + SNIPPET_AFTER + 40);
  });

  it("does not mark a cut that did not happen", () => {
    const hit = searchCall(call, TRANSCRIPT, "valuation")!;
    expect(hit.snippet!.parts[0].value.startsWith("…")).toBe(false);
  });

  // A speaker match has no paragraph to quote from, and returning nothing
  // would drop the call out of a search for somebody's name.
  it("quotes the start of the turn when the speaker's name matched", () => {
    const matches = findMatches(turns, "Priya");
    const speakerMatch = matches.find((m) => m.paragraph < 0)!;
    const snippet = snippetFor(turns, speakerMatch);
    expect(snippet?.speaker).toBe("Priya");
    expect(snippet?.parts[0].value).toContain("What did we land on");
  });

  it("is null for a match pointing at a turn that is not there", () => {
    expect(snippetFor(turns, { turn: 99, paragraph: 0, start: 0, end: 1 })).toBeNull();
    expect(snippetFor(turns, { turn: 0, paragraph: 99, start: 0, end: 1 })).toBeNull();
  });

  // Other people's words: parts, never markup.
  it("returns parts rather than a string with tags in it", () => {
    const hit = searchCall(call, TRANSCRIPT, "valuation")!;
    for (const part of hit.snippet!.parts) {
      expect(part.value).not.toMatch(/<[^>]/);
      expect(typeof part.match).toBe("boolean");
    }
  });
});

describe("callWhen", () => {
  const now = new Date("2026-03-04T18:00:00.000Z");

  // Somebody who took four calls on Tuesday needs the time to tell them
  // apart, and Tuesday is exactly the day they will be searching.
  it("gives the time for a call from today", () => {
    expect(callWhen("2026-03-04T14:15:00.000Z", now)).toMatch(/^Today, /);
  });

  it("gives the date for an older call", () => {
    const label = callWhen("2026-02-11T14:15:00.000Z", now);
    expect(label).toMatch(/Feb 11/);
    expect(label).not.toMatch(/2026/);
  });

  it("includes the year once it is a different one", () => {
    expect(callWhen("2025-11-02T14:15:00.000Z", now)).toMatch(/2025/);
  });

  it("says nothing about a date it cannot read", () => {
    expect(callWhen("not a date", now)).toBe("");
  });
});

// `callWhen` is two Intl formats per row, and the archive re-renders on every
// character typed into its search box. Measured over the fifty rows shown at
// rest: 5.29ms per keystroke against 0.15ms through reused formatters, and up
// to four times that when a search fills the page.
//
// Asserted as "the per-call API is not reached" rather than by timing, because a
// timing threshold in CI is a flake waiting to happen.
describe("call dates are not re-formatted per row", () => {
  it("labels a full page of calls without calling toLocaleTimeString or toLocaleDateString", () => {
    const time = jest.spyOn(Date.prototype, "toLocaleTimeString");
    const date = jest.spyOn(Date.prototype, "toLocaleDateString");
    try {
      const now = new Date("2026-09-29T12:00:00.000Z");
      // Both option sets: inside this year, and old enough to need its year.
      const ats = Array.from({ length: 50 }, (_, i) =>
        new Date(Date.UTC(2025 + (i % 2), i % 12, (i % 27) + 1, 14, 30)).toISOString(),
      );
      for (const at of ats) expect(callWhen(at, now)).not.toBe("");
      expect(time).not.toHaveBeenCalled();
      expect(date).not.toHaveBeenCalled();
    } finally {
      time.mockRestore();
      date.mockRestore();
    }
  });

  // The cache must not cost correctness: a call from today still reads as the
  // time alone, and one from another year still spells the year out.
  it("still distinguishes today, this year, and an older year", () => {
    const now = new Date("2026-09-29T12:00:00.000Z");
    expect(callWhen("2026-09-29T14:30:00.000Z", now)).toMatch(/^Today, /);
    expect(callWhen("2026-03-04T14:30:00.000Z", now)).not.toMatch(/2026/);
    expect(callWhen("2024-03-04T14:30:00.000Z", now)).toContain("2024");
  });
});
