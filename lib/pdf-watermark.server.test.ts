jest.mock("server-only", () => ({}), { virtual: true });
import { PDFDocument } from "pdf-lib";
import { watermarkPdf } from "./pdf-watermark.server";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([612, 792]);
  return pdf.save();
}

describe("watermarkPdf", () => {
  it("stamps every page and keeps the page count", async () => {
    const src = await blankPdf(3);
    const out = await watermarkPdf(src, "lp@example.com · 2026-09-30 14:05 UTC");
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
    expect(out.byteLength).toBeGreaterThan(src.byteLength);
  });

  it("refuses bytes that are not a PDF rather than passing them through", async () => {
    await expect(watermarkPdf(new TextEncoder().encode("not a pdf"), "x")).rejects.toThrow();
  });
});
