jest.mock("server-only", () => ({}), { virtual: true });
import { PDFDocument } from "pdf-lib";
import { canCarrySignature, documentPdf, instantiateBlocks, loadTemplate, type TemplateBlock } from "./room-signing.server";

const block = (over: Partial<TemplateBlock>): TemplateBlock => ({
  recipient_id: "signer", field_type: "signature", page: 1, x_pct: 10, y_pct: 20, width_pct: 26, height_pct: 7,
  label: "Signature", required: true, prefill: null, locked: false, ...over,
});

describe("instantiateBlocks", () => {
  const ids = { signer: "r-reader", owner: "r-owner" };

  it("gives the reader's blocks to the reader and the owner's to the countersigner", () => {
    const rows = instantiateBlocks([block({}), block({ recipient_id: "owner", y_pct: 80 })], ids, "Jane Smith", "env-1");
    expect(rows.map((r) => [r.recipient_id, r.field_type, r.page, r.y_pct])).toEqual([
      ["r-reader", "signature", 1, 20],
      ["r-owner", "signature", 1, 80],
    ]);
    expect(rows.every((r) => r.envelope_id === "env-1")).toBe(true);
  });

  it("starts an empty name block with the reader's name, and leaves what the owner pre-filled", () => {
    const rows = instantiateBlocks(
      [block({ field_type: "name" }), block({ field_type: "name", prefill: "Acme LP", locked: true }), block({ field_type: "name", recipient_id: "owner" })],
      ids,
      "Jane Smith",
      "e",
    );
    expect(rows.map((r) => [r.prefill, r.locked])).toEqual([["Jane Smith", false], ["Acme LP", true], [null, false]]);
  });
});

describe("instantiateBlocks email", () => {
  it("starts an empty email block with the reader's email, never the countersigner's", () => {
    const rows = instantiateBlocks(
      [block({ field_type: "email" }), block({ field_type: "email", recipient_id: "owner" }), block({ field_type: "email", prefill: "legal@lp.com" })],
      { signer: "r-reader", owner: "r-owner" },
      "Jane Smith",
      "e",
      "jane@lp.com",
    );
    expect(rows.map((r) => r.prefill)).toEqual(["jane@lp.com", null, "legal@lp.com"]);
  });
});

describe("what can carry a signature", () => {
  it("is an uploaded PDF or a written document, nothing else", () => {
    expect(canCarrySignature({ storage_key: "org/nda.pdf", content: null })).toBe(true);
    expect(canCarrySignature({ storage_key: null, content: "# Terms" })).toBe(true);
    expect(canCarrySignature({ storage_key: "org/deck.pptx", content: null })).toBe(false);
    expect(canCarrySignature({ storage_key: "https://example.com/x", content: null })).toBe(false);
    expect(canCarrySignature({ storage_key: null, content: "   " })).toBe(false);
  });

  it("turns a written document into a PDF to sign, and refuses a Word file", async () => {
    const pdf = await documentPdf({} as never, { name: "Terms", storage_key: null, content: "# Terms\n\nBe nice." });
    expect(pdf && (await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(await documentPdf({} as never, { name: "x", storage_key: "org/x.docx", content: null })).toBeNull();
  });
});

describe("loadTemplate", () => {
  const client = (signature_blocks: unknown) =>
    ({ from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: signature_blocks === undefined ? null : { signature_blocks } }) }; return q; } }) as never;
  it("returns the blocks the owner placed, or null when there are none", async () => {
    expect(await loadTemplate(client([block({})]), "r", "d")).toHaveLength(1);
    expect(await loadTemplate(client([]), "r", "d")).toBeNull();
    expect(await loadTemplate(client(null), "r", "d")).toBeNull();
    expect(await loadTemplate(client(undefined), "r", "d")).toBeNull();
  });
});
