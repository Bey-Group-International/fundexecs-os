// lib/workspace.test.ts
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_ICONS,
  DOC_TYPE_COLORS,
  IC_MEMO_TEMPLATE,
  FUND_THESIS_TEMPLATE,
  newBlockId,
  countWords,
  type Block,
  type DocType,
} from "@/lib/workspace";

// --- DOC_TYPE_LABELS ---------------------------------------------------------
describe("DOC_TYPE_LABELS", () => {
  it("has a label for all doc types", () => {
    const types: DocType[] = [
      "note", "ic_memo", "fund_thesis", "deal_memo",
      "diligence_report", "lp_update", "template", "wiki",
    ];
    for (const t of types) {
      expect(DOC_TYPE_LABELS[t]).toBeTruthy();
      expect(DOC_TYPE_ICONS[t]).toBeTruthy();
      expect(DOC_TYPE_COLORS[t]).toBeTruthy();
    }
  });

  it("maps ic_memo to 'IC Memo'", () => {
    expect(DOC_TYPE_LABELS.ic_memo).toBe("IC Memo");
  });
});

// --- IC_MEMO_TEMPLATE --------------------------------------------------------
describe("IC_MEMO_TEMPLATE", () => {
  it("is a non-empty array of blocks", () => {
    expect(IC_MEMO_TEMPLATE.length).toBeGreaterThan(0);
  });

  it("starts with a heading_1 block", () => {
    expect(IC_MEMO_TEMPLATE[0].type).toBe("heading_1");
  });

  it("contains a callout block for the recommendation", () => {
    const callout = IC_MEMO_TEMPLATE.find((b) => b.type === "callout");
    expect(callout).toBeDefined();
    expect(callout?.metadata?.calloutColor).toBe("gold");
  });

  it("ends with a divider", () => {
    const last = IC_MEMO_TEMPLATE[IC_MEMO_TEMPLATE.length - 1];
    expect(last.type).toBe("divider");
  });

  it("all blocks have an id and type", () => {
    for (const block of IC_MEMO_TEMPLATE) {
      expect(block.id).toBeTruthy();
      expect(block.type).toBeTruthy();
    }
  });
});

// --- FUND_THESIS_TEMPLATE ----------------------------------------------------
describe("FUND_THESIS_TEMPLATE", () => {
  it("has at least 4 blocks", () => {
    expect(FUND_THESIS_TEMPLATE.length).toBeGreaterThanOrEqual(4);
  });

  it("starts with a heading_1", () => {
    expect(FUND_THESIS_TEMPLATE[0].type).toBe("heading_1");
  });
});

// --- newBlockId --------------------------------------------------------------
describe("newBlockId", () => {
  it("returns a string starting with blk_", () => {
    expect(newBlockId()).toMatch(/^blk_/);
  });

  it("generates unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newBlockId()));
    expect(ids.size).toBe(100);
  });
});

// --- countWords --------------------------------------------------------------
describe("countWords", () => {
  it("returns 0 for an empty block array", () => {
    expect(countWords([])).toBe(0);
  });

  it("counts words in a single block", () => {
    const blocks: Block[] = [{ id: "b1", type: "paragraph", content: "Hello world" }];
    expect(countWords(blocks)).toBe(2);
  });

  it("sums words across multiple blocks", () => {
    const blocks: Block[] = [
      { id: "b1", type: "paragraph", content: "one two three" },
      { id: "b2", type: "heading_1", content: "four five" },
    ];
    expect(countWords(blocks)).toBe(5);
  });

  it("handles blocks with empty content", () => {
    const blocks: Block[] = [
      { id: "b1", type: "divider", content: "" },
      { id: "b2", type: "paragraph", content: "word" },
    ];
    expect(countWords(blocks)).toBe(1);
  });

  it("handles extra whitespace between words", () => {
    const blocks: Block[] = [{ id: "b1", type: "paragraph", content: "  hello   world  " }];
    expect(countWords(blocks)).toBe(2);
  });
});
