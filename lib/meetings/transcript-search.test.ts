import {
  MIN_QUERY,
  findMatches,
  matchSummary,
  splitParagraph,
  stepMatch,
  type SearchableTurn,
} from "@/lib/meetings/transcript-search";

const turns: SearchableTurn[] = [
  { speaker: "Alina", paragraphs: ["What did we land on for the valuation?"] },
  { speaker: "Rae", paragraphs: ["Forty, roughly.", "The valuation work is not finished."] },
  { speaker: "Alina", paragraphs: ["Understood."] },
];

describe("findMatches", () => {
  it("finds every occurrence, in reading order", () => {
    const found = findMatches(turns, "valuation");
    expect(found).toEqual([
      { turn: 0, paragraph: 0, start: 28, end: 37 },
      { turn: 1, paragraph: 1, start: 4, end: 13 },
    ]);
  });

  it("ignores case, because nobody remembers it", () => {
    expect(findMatches(turns, "VALUATION")).toHaveLength(2);
  });

  it("finds a word twice in one paragraph", () => {
    const repeated: SearchableTurn[] = [{ speaker: "Rae", paragraphs: ["yes, yes, and yes"] }];
    expect(findMatches(repeated, "yes").map((m) => m.start)).toEqual([0, 5, 14]);
  });

  // "aa" in "aaa" is one match and then another. A reader stepping through
  // hits does not expect to be shown the same three letters twice.
  it("does not report overlapping matches", () => {
    const aaa: SearchableTurn[] = [{ speaker: "R", paragraphs: ["aaaa"] }];
    expect(findMatches(aaa, "aa").map((m) => m.start)).toEqual([0, 2]);
  });

  // The query is somebody's recollection of what was said, not a pattern.
  it("treats the query as literal text", () => {
    const punctuation: SearchableTurn[] = [{ speaker: "R", paragraphs: ["the price (net) is set"] }];
    expect(findMatches(punctuation, "(net)")).toHaveLength(1);
    expect(findMatches(punctuation, ".*")).toHaveLength(0);
  });

  // One character matches most of a transcript, which is the document with
  // stripes on rather than a search result.
  it("refuses a query too short to mean anything", () => {
    expect(findMatches(turns, "v")).toEqual([]);
    expect(findMatches(turns, " ")).toEqual([]);
    expect(findMatches(turns, "")).toEqual([]);
  });

  it("survives an empty transcript", () => {
    expect(findMatches([], "valuation")).toEqual([]);
    expect(findMatches(null, "valuation")).toEqual([]);
  });
});

describe("splitParagraph", () => {
  const matches = findMatches(turns, "valuation");

  it("cuts a paragraph around its match", () => {
    expect(splitParagraph(turns[0].paragraphs[0], matches, 0, 0)).toEqual([
      { value: "What did we land on for the ", match: false, index: -1 },
      { value: "valuation", match: true, index: 0 },
      { value: "?", match: false, index: -1 },
    ]);
  });

  // The index is into the WHOLE transcript's matches, not into this line — it
  // is the number the reader is stepping through.
  it("carries the transcript-wide index, not a local one", () => {
    const parts = splitParagraph(turns[1].paragraphs[1], matches, 1, 1);
    expect(parts.find((p) => p.match)?.index).toBe(1);
  });

  it("leaves a paragraph with no match in one piece", () => {
    expect(splitParagraph("Understood.", matches, 2, 0)).toEqual([
      { value: "Understood.", match: false, index: -1 },
    ]);
  });

  it("handles a match at the very start and the very end", () => {
    const edge: SearchableTurn[] = [{ speaker: "R", paragraphs: ["yes"] }];
    expect(splitParagraph("yes", findMatches(edge, "yes"), 0, 0)).toEqual([
      { value: "yes", match: true, index: 0 },
    ]);
  });

  it("returns nothing for an empty paragraph", () => {
    expect(splitParagraph("", matches, 9, 9)).toEqual([]);
  });

  // Reassembling the parts must give back exactly what was there: this is the
  // text of a meeting, and a renderer that drops a character is rewriting it.
  it("loses nothing", () => {
    for (const [t, turn] of turns.entries()) {
      for (const [p, paragraph] of turn.paragraphs.entries()) {
        const rebuilt = splitParagraph(paragraph, matches, t, p).map((x) => x.value).join("");
        expect(rebuilt).toBe(paragraph);
      }
    }
  });
});

describe("stepMatch", () => {
  it("walks forwards and backwards", () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(1, 3, -1)).toBe(0);
  });

  // A search box that stops responding at the last hit reads as broken rather
  // than as finished.
  it("wraps at both ends", () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
  });

  it("starts at the first match going forwards and the last going back", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
  });

  it("has nowhere to go with no matches", () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1);
    expect(stepMatch(0, 0, -1)).toBe(-1);
  });
});

describe("matchSummary", () => {
  it("says nothing when nothing was typed", () => {
    expect(matchSummary(-1, 0, "")).toBe("");
    expect(matchSummary(-1, 0, "   ")).toBe("");
  });

  // Silence on a too-short query reads as "no matches", which is a different
  // and wrong answer.
  it("explains a query that is too short rather than reporting no matches", () => {
    expect(matchSummary(-1, 0, "v")).toBe(`Type at least ${MIN_QUERY} characters`);
  });

  it("reports nothing found", () => {
    expect(matchSummary(-1, 0, "tungsten")).toBe("No matches");
  });

  // Words rather than "3/17": a screen reader says "three of seventeen" and
  // "three slash seventeen" very differently.
  it("counts from one, the way a person does", () => {
    expect(matchSummary(0, 17, "valuation")).toBe("1 of 17");
    expect(matchSummary(16, 17, "valuation")).toBe("17 of 17");
  });

  it("reads as the first before anything has been stepped to", () => {
    expect(matchSummary(-1, 17, "valuation")).toBe("1 of 17");
  });
});
