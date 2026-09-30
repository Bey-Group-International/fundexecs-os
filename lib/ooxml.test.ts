/**
 * The Office reader works from the ZIP central directory and a few well-known
 * XML tags. These fixtures are real deflated archives, so the production
 * reader — not a mock — is what parses them.
 */
import { columnIndex, decodeXml, extractDocx, extractPptx, extractXlsx } from "./ooxml";
import { DOCX, PPTX, XLSX, makeZip } from "./ooxml-test-helpers";

describe("extractDocx", () => {
  it("keeps headings, joins runs, marks list items, and drops empty paragraphs", () => {
    const { text, preview } = extractDocx(makeZip(DOCX));
    expect(preview).toEqual({
      kind: "docx",
      blocks: [
        { style: "h1", text: "Fund IV Terms" },
        { style: "p", text: "Management fee: 2% & 20% carry" },
        { style: "li", text: "Hurdle 8%" },
      ],
    });
    expect(text).toContain("• Hurdle 8%");
  });

  it("refuses a file with no document body", () => {
    expect(() => extractDocx(makeZip({ "other.xml": "<x/>" }))).toThrow();
  });
});

describe("extractXlsx", () => {
  it("resolves shared strings and places cells by column reference", () => {
    const { text, preview } = extractXlsx(makeZip(XLSX));
    expect(preview.kind).toBe("xlsx");
    if (preview.kind !== "xlsx") return;
    expect(preview.sheets[0].name).toBe("Returns & NAV");
    expect(preview.sheets[0].rows).toEqual([
      ["Deal", "", "IRR"],
      ["Atlas Holdings", "", "0.215"],
    ]);
    expect(text).toContain("Atlas Holdings\t\t0.215");
  });
});

describe("extractPptx", () => {
  it("reads slides in presentation order with the title split out", () => {
    const { preview } = extractPptx(makeZip(PPTX));
    expect(preview).toEqual({
      kind: "pptx",
      slides: [{ title: "Why now", lines: ["Rates peaked", "Sellers motivated"] }],
    });
  });
});

describe("helpers", () => {
  it("maps column letters to zero-based indexes", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA3")).toBe(26);
  });

  it("decodes entities without double-decoding &amp;", () => {
    expect(decodeXml("a &amp;lt; b &#233; &#x41;")).toBe("a &lt; b é A");
  });
});
