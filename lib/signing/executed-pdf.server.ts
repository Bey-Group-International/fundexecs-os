// lib/signing/executed-pdf.server.ts
//
// One builder for every signed document in the product: the agreement (or the
// signer's own PDF), then a signature page that carries each party's drawn
// signature as an image beside their name, email, time and network hint, and the
// document's SHA-256. Pass it through sealPdf() for the tamper-evident seal.
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatSignedAt } from "@/lib/nda";
import { parseSignaturePng } from "@/lib/signing/signature-image";

export interface SignatureStamp {
  /** "Investor", "Fund", "Signer"… */
  label: string;
  name: string;
  email: string;
  signedAt: string;
  ipHint: string | null;
  /** The drawn or typed signature as a PNG data URL. */
  signaturePng: string | null;
}

export interface ExecutedPdfInput {
  title: string;
  /** Agreement text (markdown marks are stripped). Ignored when basePdf is given. */
  text?: string;
  /** The signer's own PDF: kept as is, with the signature page appended. */
  basePdf?: Uint8Array;
  stamps: SignatureStamp[];
  /** Parties that have not signed yet, shown as awaiting. */
  awaiting?: string[];
  fingerprint: string;
  recordId?: string;
}

const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

export async function buildSignedPdf(input: ExecutedPdfInput): Promise<Uint8Array> {
  let pdf: PDFDocument;
  if (input.basePdf) {
    pdf = await PDFDocument.load(input.basePdf, { ignoreEncryption: false });
  } else {
    pdf = await PDFDocument.create();
  }
  pdf.setTitle(winAnsi(input.title));
  pdf.setProducer("FundExecs");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const [W, H, M] = [612, 792, 56];
  let page: PDFPage | null = null;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (need: number) => {
    if (!page || y < M + need) newPage();
  };
  const line = (text: string, o: { font?: PDFFont; size?: number; gap?: number; color?: number } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10.5;
    for (const l of wrap(winAnsi(text), font, size, W - 2 * M)) {
      ensure(size);
      page!.drawText(l, { x: M, y: y - size, size, font, color: rgb(o.color ?? 0.1, o.color ?? 0.1, o.color ?? 0.1) });
      y -= size * 1.45;
    }
    y -= o.gap ?? 0;
  };

  if (!input.basePdf) {
    newPage();
    line((input.text ?? "").replace(/^#+\s*/gm, "").replace(/\*\*/g, ""), { gap: 12 });
  }

  // The signature page always starts on a fresh page so the agreement text is never split by it.
  newPage();
  line("Signatures", { font: bold, size: 16, gap: 10 });

  for (const s of input.stamps) {
    ensure(150);
    line(s.label, { size: 9, color: 0.4 });
    const png = parseSignaturePng(s.signaturePng);
    let embedded = null;
    if (png) {
      try {
        embedded = await pdf.embedPng(png);
      } catch {
        embedded = null;
      }
    }
    if (embedded) {
      const maxW = 220;
      const maxH = 70;
      const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      page!.drawImage(embedded, { x: M, y: y - h, width: w, height: h });
      y -= h + 4;
    } else {
      y -= 20;
    }
    page!.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 0.6, color: rgb(0.4, 0.4, 0.4) });
    y -= 4;
    line(s.name, { font: bold, size: 11 });
    line(`${s.email}  -  ${formatSignedAt(s.signedAt)}`, { size: 9, color: 0.35 });
    if (s.ipHint) line(`Network: ${s.ipHint}.x (partial address)`, { size: 8.5, color: 0.5 });
    y -= 14;
  }
  for (const label of input.awaiting ?? []) {
    ensure(40);
    line(label, { size: 9, color: 0.4 });
    line("Awaiting signature", { size: 10, color: 0.45, gap: 14 });
  }

  ensure(60);
  line("Document fingerprint (SHA-256)", { size: 9, color: 0.4 });
  line(input.fingerprint, { font: mono, size: 8.5, color: 0.25 });
  if (input.recordId) line(`Record ${input.recordId}`, { size: 8, color: 0.5 });

  return pdf.save();
}
