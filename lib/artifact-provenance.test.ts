import {
  parseSources,
  citedSourceNames,
  verificationView,
  type ArtifactSource,
} from "@/lib/artifact-provenance";

describe("parseSources", () => {
  it("parses well-formed citation rows", () => {
    const rows = [
      { source: "atlas-cim.pdf", snippet: "EBITDA of $12M", score: 0.82, kind: "document" },
      { source: "kb:underwriting", text: "Use a 5.5x entry multiple", score: 0.4, kind: "kb" },
    ];
    const parsed = parseSources(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ source: "atlas-cim.pdf", snippet: "EBITDA of $12M", score: 0.82, kind: "document" });
    // Falls back to `text` when `snippet` is absent; defaults kind sensibly.
    expect(parsed[1].snippet).toBe("Use a 5.5x entry multiple");
    expect(parsed[1].kind).toBe("kb");
  });

  it("drops unusable rows and tolerates non-arrays", () => {
    expect(parseSources(null)).toEqual([]);
    expect(parseSources("nope" as unknown as null)).toEqual([]);
    expect(parseSources([{ snippet: "no source" }, null, 7])).toEqual([]);
  });

  it("defaults a non-numeric score to 0", () => {
    const parsed = parseSources([{ source: "x", score: "high" }]);
    expect(parsed[0].score).toBe(0);
  });
});

describe("citedSourceNames", () => {
  it("returns distinct names in first-seen order", () => {
    const sources: ArtifactSource[] = [
      { source: "a", snippet: "", score: 1, kind: "document" },
      { source: "b", snippet: "", score: 1, kind: "kb" },
      { source: "a", snippet: "", score: 1, kind: "document" },
    ];
    expect(citedSourceNames(sources)).toEqual(["a", "b"]);
  });
});

describe("verificationView", () => {
  it("is 'verified' when an operator signed off, regardless of sources", () => {
    expect(verificationView({ verification_status: "verified", sources: [] }).level).toBe("verified");
  });

  it("is 'grounded' when there are citations but no sign-off", () => {
    const view = verificationView({
      verification_status: "unverified",
      sources: [{ source: "atlas.pdf", snippet: "x", score: 0.5, kind: "document" }],
    });
    expect(view.level).toBe("grounded");
    expect(view.detail).toContain("1 source");
  });

  it("is 'unverified' with no sign-off and no sources", () => {
    expect(verificationView({ verification_status: "unverified", sources: [] }).level).toBe("unverified");
  });
});
