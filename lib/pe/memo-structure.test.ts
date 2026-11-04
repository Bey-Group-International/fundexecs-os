import { DEFAULT_MEMO_TITLES, MAX_MEMO_SECTIONS, MEMO_SECTION_KEYS, parseMemoStructure } from "./memo-structure";

describe("parseMemoStructure", () => {
  it("fills a known section's default title, requires a title for an unknown one, and reports custom keys", () => {
    const p = parseMemoStructure({ sections: [{ key: "returns" }, { key: "asks", title: "Asks of the IC", required: true }, { key: "source_ledger" }] });
    expect(p.structure?.sections).toEqual([
      { key: "returns", title: "Returns", required: false },
      { key: "asks", title: "Asks of the IC", required: true },
    ]);
    expect(p.customKeys).toEqual(["asks"]);
    expect(p.dropped.join(" ")).toMatch(/"source_ledger"\): a section the skill does not generate needs a title/);
  });

  it("drops bad keys, duplicates, over-long titles and non-objects, each with a reason", () => {
    const p = parseMemoStructure({
      sections: [{ key: "Market" }, { key: "market" }, { key: "market", title: "Again" }, { key: "returns", title: "t".repeat(100) }, "x", null, { key: "mitigants", required: "yes" }],
    });
    expect(p.structure?.sections.map((s) => s.key)).toEqual(["market", "mitigants"]);
    expect(p.structure?.sections[1].required).toBe(false); // only a real true counts
    expect(p.dropped).toHaveLength(5);
  });

  it("caps the section count, and returns null for junk without throwing", () => {
    const many = Array.from({ length: MAX_MEMO_SECTIONS + 5 }, (_, i) => ({ key: `custom_${i}`, title: `C${i}` }));
    const p = parseMemoStructure({ sections: many });
    expect(p.structure?.sections).toHaveLength(MAX_MEMO_SECTIONS);
    expect(p.dropped).toHaveLength(5);
    for (const junk of [null, undefined, "x", 3, [], {}, { sections: "no" }, { sections: [] }]) expect(parseMemoStructure(junk).structure).toBeNull();
  });

  it("covers the skill's twelve sections with a default title each", () => {
    expect(MEMO_SECTION_KEYS).toHaveLength(12);
    for (const k of MEMO_SECTION_KEYS) expect(DEFAULT_MEMO_TITLES[k]).toBeTruthy();
  });
});
