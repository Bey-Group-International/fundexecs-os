// lib/signing/stamp.server.ts
//
// Writes what signers filled in onto the document itself: each block's value, or
// the drawn signature, at the position the owner placed it. Positions are stored as
// percentages of the page measured from the top-left, so they hold at any zoom.
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { parseSignaturePng } from "@/lib/signing/signature-image";

export interface StampField {
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  /** "signature" draws the image; every other block draws its text. */
  type: string;
  value: string | null;
  signaturePng?: string | null;
}

const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function fit(text: string, font: PDFFont, width: number, height: number, multiline: boolean): { lines: string[]; size: number } {
  const maxSize = Math.min(11, height * 0.8);
  for (let size = maxSize; size >= 6; size -= 0.5) {
    const lines: string[] = [];
    for (const para of text.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (!multiline || font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    const tallEnough = lines.length * size * 1.2 <= height + 0.5;
    const wideEnough = lines.every((l) => font.widthOfTextAtSize(l, size) <= width + 0.5);
    if (tallEnough && wideEnough) return { lines, size };
  }
  // Too long for its box even at the smallest size: show what fits rather than spill over the page.
  const size = 6;
  const lines = text.split(/\r?\n/).map((l) => {
    let t = l;
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1);
    return t;
  });
  return { lines: lines.slice(0, Math.max(1, Math.floor(height / (size * 1.2)))), size };
}

export async function stampBlocks(pdfBytes: Uint8Array, fields: StampField[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const images = new Map<string, PDFImage>();

  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const w = (f.widthPct / 100) * pw;
    const h = (f.heightPct / 100) * ph;
    const x = (f.xPct / 100) * pw;
    const top = ph - (f.yPct / 100) * ph;

    if (f.type === "signature") {
      const png = parseSignaturePng(f.signaturePng);
      if (!png) continue;
      const key = f.signaturePng as string;
      let img = images.get(key);
      if (!img) {
        try {
          img = await pdf.embedPng(png);
        } catch {
          continue;
        }
        images.set(key, img);
      }
      const scale = Math.min(w / img.width, h / img.height);
      const iw = img.width * scale;
      const ih = img.height * scale;
      page.drawImage(img, { x, y: top - h + (h - ih) / 2, width: iw, height: ih });
      continue;
    }

    const value = (f.value ?? "").trim();
    if (!value) continue;
    const { lines, size } = fit(winAnsi(value), font, w, h, f.type === "address");
    let y = top - size;
    for (const line of lines) {
      page.drawText(line, { x, y, size, font, color: rgb(0.05, 0.05, 0.25) });
      y -= size * 1.2;
    }
  }
  return pdf.save();
}
