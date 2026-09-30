import {
  mergeFindings,
  ruleFindings,
  suggestRoomShareSettings,
  suggestSection,
  suggestShareSettings,
} from "./document-review";

const NOW = new Date("2026-09-30T00:00:00Z");

describe("suggestSection", () => {
  it("reads the filename first", () => {
    expect(suggestSection("Fund IV LPA (executed).pdf", "").section).toBe("fund_terms");
    expect(suggestSection("2025 Audited Financial Statements", "").section).toBe("financials");
  });

  it("falls back to the text when the name says nothing", () => {
    const s = suggestSection("scan_0031.pdf", "Due diligence questionnaire (ILPA). Section 1 …");
    expect(s.section).toBe("diligence");
    expect(s.confidence).toBeGreaterThan(0);
  });

  it("returns other with zero confidence when nothing matches", () => {
    expect(suggestSection("notes.txt", "lunch order")).toEqual({ section: "other", confidence: 0 });
  });
});

describe("ruleFindings", () => {
  const base = { name: "Deck", section: "marketing", textStatus: "ok" as const, now: NOW };

  it("blocks on an unfilled placeholder and quotes where it is", () => {
    const f = ruleFindings({ ...base, text: "Target fund size of [TBD] with a first close in 2026." });
    const hit = f.find((x) => x.title === "Unfilled placeholder");
    expect(hit?.severity).toBe("blocker");
    expect(hit?.location).toContain("[TBD]");
  });

  it("blocks performance shown without a past-performance disclaimer", () => {
    const f = ruleFindings({ ...base, text: "Fund III: 24% net IRR, 2.1x MOIC. 2024 2025 2026" });
    expect(f.some((x) => x.severity === "blocker" && /disclaimer/i.test(x.title))).toBe(true);
    const ok = ruleFindings({
      ...base,
      text: "Fund III: 24% net IRR. Past performance is not indicative of future results. 2024 2025 2026",
    });
    expect(ok.some((x) => /disclaimer/i.test(x.title))).toBe(false);
  });

  it("flags stale material and a missing confidentiality legend on sensitive sections", () => {
    const f = ruleFindings({ ...base, section: "financials", text: "Balance sheet 2021, 2022, 2023." });
    expect(f.map((x) => x.title)).toEqual(expect.arrayContaining(["May be out of date", "No confidentiality legend"]));
  });

  it("asks for OCR on a scanned PDF and says nothing else", () => {
    expect(ruleFindings({ ...base, text: "", textStatus: "empty" })).toEqual([
      expect.objectContaining({ title: "No searchable text" }),
    ]);
  });
});

describe("share suggestions", () => {
  it("locks down terms and performance", () => {
    const s = suggestShareSettings({ name: "LPA", section: "fund_terms" });
    expect(s).toMatchObject({ requireNda: true, allowDownload: false, watermark: true });
  });

  it("lets marketing travel", () => {
    const s = suggestShareSettings({ name: "Deck", section: "marketing" });
    expect(s).toMatchObject({ requireNda: false, allowDownload: true, watermark: false });
  });

  it("sets a room link by its most sensitive section", () => {
    const s = suggestRoomShareSettings({ roomName: "Fund IV", sections: ["marketing", "financials"] });
    expect(s.requireNda).toBe(true);
  });
});

describe("mergeFindings", () => {
  it("keeps the model's findings, adds uncovered rules, and puts blockers first", () => {
    const merged = mergeFindings(
      [{ severity: "nit", title: "Typo on slide 3", detail: "x" }],
      [
        { severity: "blocker", title: "Unfilled placeholder", detail: "y" },
        { severity: "suggestion", title: "Typo on slide 3", detail: "dup" },
      ],
    );
    expect(merged.map((m) => m.title)).toEqual(["Unfilled placeholder", "Typo on slide 3"]);
  });
});
