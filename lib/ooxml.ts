// lib/ooxml.ts
//
// Reading the words out of .docx, .xlsx and .pptx files, server-side and with no
// dependency beyond Node's zlib.
//
// All three are ZIP archives of XML parts. We do not need to lay them out — the
// consumers are Earn (which needs the text to reason over) and the in-app
// preview (which needs paragraphs, sheet rows, and slide bullets, not pixels) —
// so this reads the central directory, inflates only the parts it needs, and
// pulls text out of the XML with narrow regexes over well-known tags. A full XML
// parser would be more general and no more correct for this job.
//
// Bounded throughout: a hostile or merely enormous file must degrade to a
// truncated preview, never to a function that runs out of memory.
import { inflateRawSync } from "node:zlib";

/** Hard ceiling on any one inflated part (a 300k-row sheet XML is ~200 MB). */
const MAX_PART_BYTES = 64 * 1024 * 1024;
/** Preview limits — what a reader can usefully scroll, not the whole file. */
export const PREVIEW_MAX_ROWS = 200;
export const PREVIEW_MAX_COLS = 30;
export const PREVIEW_MAX_SHEETS = 12;

export type OfficePreview =
  | { kind: "docx"; blocks: { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[] }
  | { kind: "xlsx"; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
  | { kind: "pptx"; slides: { title: string; lines: string[] }[] };

export interface OfficeExtraction {
  text: string;
  preview: OfficePreview;
}

// ─── ZIP ──────────────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export function readZipDirectory(buf: Buffer): Map<string, ZipEntry> {
  // End-of-central-directory record: last 22 bytes + up to 64 KB of comment.
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid Office file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipText(buf: Buffer, entries: Map<string, ZipEntry>, name: string): string | null {
  const e = entries.get(name);
  if (!e) return null;
  if (e.uncompressedSize > MAX_PART_BYTES) throw new Error("This file is too large to preview.");
  const lh = e.localOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) return null;
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw.toString("utf8");
  if (e.method === 8) {
    return inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES }).toString("utf8");
  }
  return null;
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Concatenated text of every `<tag>` run inside `xml` (e.g. w:t, a:t). */
function runs(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  let out = "";
  for (const m of xml.matchAll(re)) out += decodeXml(m[1]);
  return out;
}

function relTargets(relsXml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml) return map;
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

/** Resolve a relationship target against the directory of the part holding it. */
function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${baseDir}/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

// ─── Word ─────────────────────────────────────────────────────────────────────

export function extractDocx(buf: Buffer): OfficeExtraction {
  const zip = readZipDirectory(buf);
  const xml = readZipText(buf, zip, "word/document.xml");
  if (xml == null) throw new Error("This Word file has no document body.");
  const blocks: { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[] = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const body = m[1] ?? "";
    const text = body
      .replace(/<w:tab\/>/g, "<w:t>\t</w:t>")
      .replace(/<w:br\/>/g, "<w:t>\n</w:t>");
    const line = runs(text, "w:t").trim();
    if (!line) continue;
    const styleVal = /<w:pStyle w:val="([^"]+)"/.exec(body)?.[1]?.toLowerCase() ?? "";
    const style: "h1" | "h2" | "h3" | "p" | "li" =
      styleVal === "title" || styleVal === "heading1"
        ? "h1"
        : styleVal === "heading2"
          ? "h2"
          : /^heading[3-9]$/.test(styleVal)
            ? "h3"
            : /<w:numPr>/.test(body) || styleVal.includes("list")
              ? "li"
              : "p";
    blocks.push({ style, text: line });
  }
  return {
    text: blocks.map((b) => (b.style === "li" ? `• ${b.text}` : b.text)).join("\n"),
    preview: { kind: "docx", blocks },
  };
}

// ─── Excel ────────────────────────────────────────────────────────────────────

/** "BC12" → 54 (zero-based column index). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function extractXlsx(buf: Buffer): OfficeExtraction {
  const zip = readZipDirectory(buf);
  const workbook = readZipText(buf, zip, "xl/workbook.xml");
  if (workbook == null) throw new Error("This Excel file has no workbook.");
  const rels = relTargets(readZipText(buf, zip, "xl/_rels/workbook.xml.rels"));

  const shared: string[] = [];
  const sst = readZipText(buf, zip, "xl/sharedStrings.xml");
  if (sst) {
    for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runs(m[1], "t"));
  }

  const sheets: { name: string; rows: string[][]; truncated: boolean }[] = [];
  const textParts: string[] = [];
  const sheetTags = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].slice(0, PREVIEW_MAX_SHEETS);
  for (const tag of sheetTags) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(tag[0])?.[1] ?? "Sheet");
    const rid = /\br:id="([^"]+)"/.exec(tag[0])?.[1];
    const target = rid ? rels.get(rid) : undefined;
    if (!target) continue;
    const xml = readZipText(buf, zip, resolvePart("xl", target));
    if (!xml) continue;

    const rows: string[][] = [];
    let truncated = false;
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= PREVIEW_MAX_ROWS) {
        truncated = true;
        break;
      }
      const row: string[] = [];
      for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const inner = cm[2] ?? "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const col = ref ? columnIndex(ref) : row.length;
        if (col >= PREVIEW_MAX_COLS) {
          truncated = true;
          continue;
        }
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (type === "s" && v != null) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = runs(inner, "t");
        else if (type === "b" && v != null) value = v === "1" ? "TRUE" : "FALSE";
        else if (v != null) value = decodeXml(v);
        while (row.length < col) row.push("");
        row[col] = value;
      }
      rows.push(row);
    }
    // Drop trailing empty rows; a formatted-but-empty sheet is still empty.
    while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
    sheets.push({ name, rows, truncated });
    textParts.push(`## ${name}\n${rows.map((r) => r.join("\t")).join("\n")}`);
  }
  return { text: textParts.join("\n\n"), preview: { kind: "xlsx", sheets } };
}

// ─── PowerPoint ───────────────────────────────────────────────────────────────

export function extractPptx(buf: Buffer): OfficeExtraction {
  const zip = readZipDirectory(buf);
  const pres = readZipText(buf, zip, "ppt/presentation.xml");
  if (pres == null) throw new Error("This PowerPoint file has no slides.");
  const rels = relTargets(readZipText(buf, zip, "ppt/_rels/presentation.xml.rels"));

  const slides: { title: string; lines: string[] }[] = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*\/?>/g)) {
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const target = rid ? rels.get(rid) : undefined;
    if (!target) continue;
    const xml = readZipText(buf, zip, resolvePart("ppt", target));
    if (!xml) continue;

    let title = "";
    const lines: string[] = [];
    for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const isTitle = /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(sp[0]);
      for (const para of sp[0].matchAll(/<a:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:p>)/g)) {
        const line = runs(para[1] ?? "", "a:t").trim();
        if (!line) continue;
        if (isTitle && !title) title = line;
        else lines.push(line);
      }
    }
    slides.push({ title, lines });
  }
  const text = slides
    .map((s, i) => `Slide ${i + 1}${s.title ? `: ${s.title}` : ""}\n${s.lines.join("\n")}`)
    .join("\n\n");
  return { text, preview: { kind: "pptx", slides } };
}
