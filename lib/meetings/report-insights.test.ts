/**
 * Reading the report's insight fields: whatever shape the model gave them,
 * and nothing at all on a report written before they existed.
 */
import {
  MAX_HIGHLIGHTS,
  commitmentsByPerson,
  normalizeHighlights,
  reportInsights,
  splitOwner,
} from "./report-insights";

describe("normalizeHighlights", () => {
  it("keeps the asked-for shape and drops the quotation marks around a quote", () => {
    expect(normalizeHighlights([{ point: "Valuation agreed at $40M", quote: "“we can do forty pre”" }])).toEqual([
      { point: "Valuation agreed at $40M", quote: "we can do forty pre" },
    ]);
  });

  it("takes a bare string as a point with no quote, and a lone quote as its own point", () => {
    expect(normalizeHighlights(["LPAC sign-off needed", { quote: "cap it at fifteen" }])).toEqual([
      { point: "LPAC sign-off needed", quote: "" },
      { point: "cap it at fifteen", quote: "cap it at fifteen" },
    ]);
  });

  it("drops empties and repeats, and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ point: `Moment ${i}`, quote: "x" }));
    expect(normalizeHighlights([{ point: "" }, null, "A", "a", ...many])).toHaveLength(MAX_HIGHLIGHTS);
    expect(normalizeHighlights([{ point: "" }, null, "A", "a"])).toEqual([{ point: "A", quote: "" }]);
  });

  it("is empty for anything that is not a list", () => {
    expect(normalizeHighlights(undefined)).toEqual([]);
    expect(normalizeHighlights("A highlight")).toEqual([]);
  });
});

describe("splitOwner", () => {
  it("splits a named owner from the question", () => {
    expect(splitOwner("Jane Doe: Will the LPAC accept 15%?")).toEqual({ owner: "Jane Doe", text: "Will the LPAC accept 15%?" });
  });

  it("leaves a line whole when the prefix is not a name", () => {
    expect(splitOwner("Whether counsel clears it: unclear")).toEqual({ owner: null, text: "Whether counsel clears it: unclear" });
    expect(splitOwner("note: lowercase is not a name")).toEqual({ owner: null, text: "note: lowercase is not a name" });
    expect(splitOwner("No owner at all")).toEqual({ owner: null, text: "No owner at all" });
  });
});

describe("reportInsights", () => {
  it("is empty for a report written before these fields existed", () => {
    expect(reportInsights({ decisions: ["x"] })).toEqual({ highlights: [], unresolved: [], risks: [], agenda: [] });
    expect(reportInsights(null)).toEqual({ highlights: [], unresolved: [], risks: [], agenda: [] });
  });

  it("reads each field", () => {
    const got = reportInsights({
      highlights: [{ point: "P", quote: "Q" }],
      unresolved: ["Sam: Who signs?"],
      risks: [{ text: "Counsel may be late" }],
      next_meeting_agenda: ["Side letter", "LPAC"],
    });
    expect(got.highlights).toEqual([{ point: "P", quote: "Q" }]);
    expect(got.unresolved).toEqual([{ owner: "Sam", text: "Who signs?" }]);
    expect(got.risks).toEqual(["Counsel may be late"]);
    expect(got.agenda).toEqual(["Side letter", "LPAC"]);
  });
});

describe("commitmentsByPerson", () => {
  it("groups by owner in order of first appearance, unowned last, ignoring case", () => {
    const groups = commitmentsByPerson([
      { owner: "Priya", t: "a" },
      { owner: null, t: "b" },
      { owner: "Alex", t: "c" },
      { owner: "priya ", t: "d" },
    ]);
    expect(groups.map((g) => [g.owner, g.items.map((x) => x.index)])).toEqual([
      ["Priya", [0, 3]],
      ["Alex", [2]],
      [null, [1]],
    ]);
  });
});
