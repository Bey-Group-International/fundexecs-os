/**
 * Placing the report's lines on the recording, and links to moments.
 *
 * The rule that matters most is the refusal: a chip that plays the wrong minute
 * is worse than none, so a weak overlap must place nothing.
 */
import {
  momentClock,
  momentFor,
  momentFromSearch,
  momentLink,
  momentWords,
} from "./report-moments";
import type { TranscriptCue } from "./transcript-cues";

const cue = (atMs: number, text: string, speaker = "Priya"): TranscriptCue => ({
  speaker,
  atMs,
  uncertain: false,
  overlapped: false,
  paragraphs: [text],
});

const CUES = [
  cue(0, "Morning everyone, thanks for joining. Let's get started."),
  cue(65_000, "On Dunbar, I think the valuation is still too high for us at forty."),
  cue(190_000, "Agreed. I'll send the valuation memo to counsel by Friday.", "Sam"),
  cue(400_000, "Last thing: we hire a second analyst next quarter."),
  cue(520_000, "To confirm, Sam sends the valuation memo Friday.", "Priya"),
];

describe("momentWords", () => {
  it("keeps the distinctive words and drops the filler", () => {
    expect([...momentWords("We'll send the memos to counsel by Friday")]).toEqual(
      expect.arrayContaining(["send", "memo", "counsel", "friday"]),
    );
    expect(momentWords("and then we will have that")).toEqual(new Set());
  });

  it("meets different forms of the same word", () => {
    expect(momentWords("agreed")).toEqual(momentWords("agree"));
    expect(momentWords("sending")).toEqual(momentWords("send"));
  });
});

describe("momentFor", () => {
  it("places an action item at the turn it came from", () => {
    expect(momentFor("Sam to send the valuation memo to counsel by Friday", CUES)).toBe(190_000);
  });

  it("places a decision", () => {
    expect(momentFor("Hire a second analyst next quarter", CUES)).toBe(400_000);
  });

  it("takes the first of equally good turns, where the discussion was", () => {
    expect(momentFor("valuation memo Friday", CUES)).toBe(190_000);
  });

  it("places nothing on a weak overlap rather than the wrong minute", () => {
    expect(momentFor("Review the Q3 marketing budget and valuation of the brand", CUES)).toBeNull();
  });

  it("places nothing for a line too short to match on", () => {
    expect(momentFor("Agreed", CUES)).toBeNull();
    expect(momentFor("Send the memo", [])).toBeNull();
  });
});

describe("momentClock", () => {
  it("reads like a player's clock", () => {
    expect(momentClock(0)).toBe("0:00");
    expect(momentClock(245_900)).toBe("4:05");
    expect(momentClock(3_729_000)).toBe("1:02:09");
  });
});

describe("momentFromSearch", () => {
  it.each([
    ["?t=754", 754_000],
    ["t=754", 754_000],
    ["?t=12:34", 754_000],
    ["?t=1:02:09", 3_729_000],
    ["?t=12m34s", 754_000],
    ["?t=1h2m9s", 3_729_000],
    ["?t=90s", 90_000],
    ["?x=1&t=2.5", 2_500],
  ])("reads %s", (search, ms) => {
    expect(momentFromSearch(search)).toBe(ms);
  });

  it.each([[""], ["?t="], ["?t=soon"], ["?t=-5"], ["?other=3"]])("ignores %p", (search) => {
    expect(momentFromSearch(search)).toBeNull();
  });
});

describe("momentLink", () => {
  it("adds the moment in whole seconds and opens the recording tab", () => {
    expect(momentLink("https://app.example/meetings/abc/report#overview", 754_900)).toBe(
      "https://app.example/meetings/abc/report?t=754#recording",
    );
  });

  it("replaces a moment already in the link", () => {
    expect(momentLink("https://app.example/meetings/abc/report?t=10&x=1", 20_000)).toBe(
      "https://app.example/meetings/abc/report?t=20&x=1#recording",
    );
  });
});
