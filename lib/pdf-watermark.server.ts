// lib/pdf-watermark.server.ts
//
// Stamp a reader's identity across every page of a PDF as it is served.
//
// A watermark does not stop a copy; it makes the copy traceable, which is what
// changes behaviour. So it is drawn big and diagonal (hard to crop out) and
// repeated along the footer (survives a screenshot of one region).
import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

/** PDFs larger than this are not rewritten in a serverless function. */
export const MAX_WATERMARK_BYTES = 40 * 1024 * 1024;

export async function watermarkPdf(bytes: Uint8Array, label: string): Promise<Uint8Array> {
  // `ignoreEncryption` lets owner-password PDFs (print/copy restrictions only)
  // through; a PDF that genuinely needs a password to open fails to parse and
  // the caller serves nothing rather than an unmarked copy.
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // Standard fonts are WinAnsi only; drop what they cannot draw rather than throw.
  const text = label.replace(/[^\x20-\x7E·]/g, "?");

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const diagonalSize = Math.max(14, Math.min(width, height) / 22);
    const textWidth = font.widthOfTextAtSize(text, diagonalSize);
    // Three diagonal bands across the page.
    for (const t of [0.25, 0.5, 0.75]) {
      page.drawText(text, {
        x: width / 2 - (textWidth / 2) * Math.cos(Math.PI / 6),
        y: height * t - (textWidth / 2) * Math.sin(Math.PI / 6),
        size: diagonalSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.16,
        rotate: degrees(30),
      });
    }
    page.drawText(text, {
      x: 24,
      y: 12,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.4),
      opacity: 0.6,
    });
  }
  return pdf.save();
}
