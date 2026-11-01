// lib/file-watermark.server.ts
//
// Stamp a reader's identity onto the non-PDF files a watermarked link serves.
// (PDFs are handled in pdf-watermark.server.ts.)
//
// What can be marked, and what cannot:
//
//   image  (.png .jpg .jpeg .webp .gif)  drawn over the pixels. A GIF or WebP comes
//                                        back as its first frame: an animation cannot
//                                        be stamped frame by frame here. A GIF is
//                                        returned as a PNG.
//   text   (.txt .md)                    a banner above and below the text.
//   none   Office files, CSV, RTF, video, and anything else. There is no honest way
//          to put a mark into their bytes, so the caller must not hand out those
//          bytes on a watermarked link. They are read in the viewer, which draws the
//          label over them.
//
// The label is drawn from a built-in 5x7 bitmap font as plain vector shapes, not as
// SVG text. SVG text needs fonts on the machine; a serverless function may have
// none, and the label would silently not appear, which is a watermark that is
// absent. Shapes cannot go missing that way.
import "server-only";
import sharp from "sharp";
import { fileExtension } from "@/lib/document-files";

export type WatermarkPlan = "pdf" | "image" | "text" | "none";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTS = new Set([".txt", ".md"]);

/** Larger than this is not decoded and re-encoded in a serverless function. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Decoded pixel budget, so a small file that expands hugely is refused. */
const MAX_IMAGE_PIXELS = 80_000_000;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export function watermarkPlan(storageKey: string): WatermarkPlan {
  const ext = fileExtension(storageKey);
  if (ext === ".pdf") return "pdf";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (TEXT_EXTS.has(ext)) return "text";
  return "none";
}

// --- 5x7 bitmap font ---------------------------------------------------------

const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11110 00001 00001 01110 00001 00001 11110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  "@": "01110 10001 10111 10101 10111 10000 01110",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  _: "00000 00000 00000 00000 00000 00000 11111",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  "·": "00000 00000 00000 01100 01100 00000 00000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
  "?": "01110 10001 00001 00010 00100 00000 00100",
};
const GLYPH_ROWS = new Map(
  Object.entries(GLYPHS).map(([ch, rows]) => [ch, rows.split(" ")]),
);
const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = GLYPH_W + 1;

/** Upper-case what has an upper case; anything the font lacks becomes `?`. */
function normalise(label: string): string {
  return [...label.toUpperCase()]
    .map((c) => (GLYPH_ROWS.has(c) ? c : "?"))
    .join("");
}

/** The label as one SVG path (in cell units, origin top-left) and its width in cells. */
function labelPath(label: string): { d: string; cells: number } {
  const text = normalise(label);
  let d = "";
  let x = 0;
  for (const ch of text) {
    const rows = GLYPH_ROWS.get(ch)!;
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (rows[r][c] === "1") d += `M${x + c} ${r}h1v1h-1z`;
      }
    }
    x += ADVANCE;
  }
  return { d, cells: Math.max(1, x - 1) };
}

/** The overlay for a width x height image: three diagonal bands and a footer line. */
export function overlaySvg(
  label: string,
  width: number,
  height: number,
): string {
  const { d, cells } = labelPath(label);
  const short = Math.min(width, height);
  // Big enough to read and hard to crop out, small enough to fit the short side.
  const cell = Math.max(0.9, (short * 0.8) / cells);
  const bands = [0.25, 0.5, 0.75]
    .map((t) => {
      const cx = width / 2;
      const cy = height * t;
      return (
        `<g transform="translate(${cx} ${cy}) rotate(-30) scale(${cell}) translate(${-cells / 2} ${-GLYPH_H / 2})">` +
        // A dark shadow under a light copy: readable on white, black and mid-tones alike.
        `<path d="${d}" transform="translate(0.7 0.7)" fill="#000000" fill-opacity="0.28"/>` +
        `<path d="${d}" fill="#ffffff" fill-opacity="0.38"/></g>`
      );
    })
    .join("");
  const fc = Math.max(1, Math.min(3, width / (cells * 1.2)));
  const barH = (GLYPH_H + 4) * fc;
  const footer =
    `<rect x="0" y="${height - barH}" width="${width}" height="${barH}" fill="#ffffff" fill-opacity="0.65"/>` +
    `<g transform="translate(${3 * fc} ${height - barH + 2 * fc}) scale(${fc})"><path d="${d}" fill="#333333" fill-opacity="0.85"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bands}${footer}</svg>`;
}

// --- images ------------------------------------------------------------------

export interface StampedImage {
  bytes: Buffer;
  contentType: string;
  /** Extension the stamped file should carry (a GIF comes back as .png). */
  ext: string;
}

export async function watermarkImage(
  bytes: Uint8Array,
  label: string,
  ext: string,
): Promise<StampedImage> {
  const input = Buffer.from(bytes);
  const opts = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" as const };
  const meta = await sharp(input, opts).metadata();
  if (!meta.width || !meta.height) throw new Error("image has no size");
  // EXIF orientations 5-8 turn the picture on its side: draw on the upright size.
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = sideways ? meta.height : meta.width;
  const height = sideways ? meta.width : meta.height;

  const pipeline = sharp(input, opts)
    .rotate()
    .composite([
      { input: Buffer.from(overlaySvg(label, width, height)), top: 0, left: 0 },
    ]);

  if (ext === ".jpg" || ext === ".jpeg") {
    return {
      bytes: await pipeline.jpeg({ quality: 90 }).toBuffer(),
      contentType: "image/jpeg",
      ext,
    };
  }
  if (ext === ".webp") {
    return {
      bytes: await pipeline.webp({ quality: 90 }).toBuffer(),
      contentType: "image/webp",
      ext,
    };
  }
  // .png, and .gif (first frame only) as PNG.
  return {
    bytes: await pipeline.png().toBuffer(),
    contentType: "image/png",
    ext: ".png",
  };
}

// --- text --------------------------------------------------------------------

export function watermarkText(bytes: Uint8Array, label: string): Buffer {
  const body = new TextDecoder("utf-8").decode(bytes);
  // One line, whatever the label holds, so it cannot be made to look like content.
  const mark = `=== ${label.replace(/[\r\n]+/g, " ")} ===`;
  return Buffer.from(`${mark}\n\n${body}\n\n${mark}\n`, "utf-8");
}
