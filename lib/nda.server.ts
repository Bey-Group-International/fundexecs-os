// lib/nda.server.ts
//
// A data-room NDA signature as a record: the fingerprint of the text signed,
// the PDF both sides keep, and the link that lets the signer (who has no
// account) download their own copy.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { escapeHtml } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import { formatSignedAt } from "@/lib/nda";

/** SHA-256 of the exact text signed, hex. Proves which wording a signature covers. */
export function ndaFingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function copySecret(): string {
  // Derived from the service-role key, as the data-room gate's is: nothing new
  // to provision, and present wherever the data room works at all.
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", "fx-nda-copy").update(base).digest("hex");
}

/** The token in a signer's download link: this signature, and only this one. */
export function ndaCopyToken(signatureId: string): string {
  return createHmac("sha256", copySecret()).update(signatureId).digest("base64url");
}

export function ndaCopyTokenValid(signatureId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(ndaCopyToken(signatureId));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function ndaCopyUrl(signatureId: string): string {
  return `${SITE_URL}/api/dataroom/nda/${signatureId}?t=${ndaCopyToken(signatureId)}`;
}

export interface NdaRecord {
  id: string;
  signerName: string;
  signerEmail: string | null;
  signedAt: string;
  ipHint: string | null;
  text: string | null;
  sha256: string | null;
  agreed: boolean;
  orgName: string;
  roomName: string | null;
  linkLabel: string | null;
}

// Standard fonts are WinAnsi only; anything they cannot draw becomes "?" rather
// than failing the whole document.
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
      // A single word wider than the line is cut rather than overflowing.
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

/** The signed NDA as a PDF: the agreement text, then who signed it and when. */
export async function buildNdaPdf(r: NdaRecord): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`NDA - ${winAnsi(r.signerName)}`);
  pdf.setProducer("FundExecs");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const [W, H, M] = [612, 792, 56];
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const line = (text: string, opts: { font?: PDFFont; size?: number; gap?: number; color?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    for (const l of wrap(winAnsi(text), font, size, W - 2 * M)) {
      if (y < M + size) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      page.drawText(l, { x: M, y: y - size, size, font, color: rgb(opts.color ?? 0.1, opts.color ?? 0.1, opts.color ?? 0.1) });
      y -= size * 1.45;
    }
    y -= opts.gap ?? 0;
  };

  line("Non-Disclosure Agreement", { font: bold, size: 18, gap: 4 });
  line(
    [r.orgName, r.roomName ? `${r.roomName} data room` : null, r.linkLabel ? `link: ${r.linkLabel}` : null]
      .filter(Boolean)
      .join(" - "),
    { size: 10, color: 0.4, gap: 14 },
  );

  if (r.text) {
    line(r.text, { gap: 18 });
  } else {
    line("The text of this agreement was not recorded: it was signed before signatures kept their text.", {
      color: 0.4,
      gap: 18,
    });
  }

  line("Signature", { font: bold, size: 12, gap: 4 });
  line(`Signed by: ${r.signerName}`);
  if (r.signerEmail) line(`Email: ${r.signerEmail}`);
  line(`Signed at: ${formatSignedAt(r.signedAt)}`);
  if (r.agreed) line('Agreement: the signer checked "I have read and agree to this NDA" and typed their full name.');
  if (r.ipHint) line(`Network: ${r.ipHint}.x (partial address)`);
  if (r.sha256) {
    y -= 6;
    line("Text fingerprint (SHA-256):", { size: 9, color: 0.4 });
    line(r.sha256, { font: mono, size: 8.5, color: 0.25 });
  }
  y -= 10;
  line(`Record ${r.id}`, { size: 8, color: 0.5 });
  return pdf.save();
}

export function ndaCopyEmail(args: {
  orgName: string;
  roomName: string | null;
  signerName: string;
  signedAt: string;
  sha256: string;
  downloadUrl: string;
}): { subject: string; html: string } {
  const where = args.roomName ? `the ${args.roomName} data room` : "the data room";
  const first = args.signerName.trim().split(/\s+/)[0] ?? "";
  return {
    subject: `Your signed NDA with ${args.orgName}`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; color: #111;">
<p>${first ? `Hi ${escapeHtml(first)},` : "Hi,"}</p>
<p>This is your copy of the non-disclosure agreement you signed to enter ${escapeHtml(where)} shared by ${escapeHtml(args.orgName)}.</p>
<p><a href="${escapeHtml(args.downloadUrl)}">Download the signed NDA (PDF)</a></p>
<p style="color:#555;font-size:12px;">Signed by ${escapeHtml(args.signerName)} on ${escapeHtml(formatSignedAt(args.signedAt))}.<br />Text fingerprint (SHA-256): <span style="font-family:monospace;">${escapeHtml(args.sha256)}</span></p>
</div>`,
  };
}
