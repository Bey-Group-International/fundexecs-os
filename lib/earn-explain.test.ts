import { explainInstructions, explainPrompt, parseExplainRecordRef } from "@/lib/earn-explain";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("parseExplainRecordRef", () => {
  it("accepts the four record types with an id", () => {
    for (const type of ["deal", "investor", "contact", "document", "pulse"] as const) {
      expect(parseExplainRecordRef({ type, id: ID })).toEqual({ type, id: ID });
    }
  });

  it("rejects unknown types, bad ids, and junk", () => {
    expect(parseExplainRecordRef({ type: "fund", id: ID })).toBeNull();
    expect(parseExplainRecordRef({ type: "deal", id: "x; drop table" })).toBeNull();
    expect(parseExplainRecordRef({ type: "deal" })).toBeNull();
    expect(parseExplainRecordRef("deal")).toBeNull();
    expect(parseExplainRecordRef(null)).toBeNull();
  });
});

describe("explainPrompt", () => {
  it("names the record in a clean one-liner", () => {
    expect(explainPrompt("deal", "  Project   Atlas ")).toBe("Explain Project Atlas");
    expect(explainPrompt("document", "")).toBe("Explain this document");
    expect(explainPrompt("contact", "x".repeat(300))).toHaveLength("Explain ".length + 120);
  });
});

describe("explainInstructions", () => {
  it("asks for a bottom line, take, and rated claims", () => {
    const block = explainInstructions("document", { webSearch: false });
    expect(block).toMatch(/Earn's take/);
    expect(block).toMatch(/True \/ Mostly true \/ Misleading \/ False \/ Unverified/);
    expect(block).toMatch(/not instructions/);
  });

  it("mentions the web_search tool only when search is on", () => {
    expect(explainInstructions("deal", { webSearch: true })).toMatch(/web_search tool/);
    expect(explainInstructions("deal", { webSearch: false })).toMatch(/Live web search is off/);
  });
});
