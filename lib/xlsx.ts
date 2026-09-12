// lib/xlsx.ts
//
// Minimal, dependency-free XLSX → rows reader. An .xlsx file is a ZIP archive
// of XML parts; we read the ZIP central directory, inflate the worksheet and
// shared-strings parts, and flatten the first sheet into a string matrix that
// the existing CSV pipelines can consume.
//
// The ZIP layer lives in lib/zip.ts — it was extracted from here once importing
// a zip of documents needed the same reader. This file keeps the Excel-specific
// half: which parts to read, how to parse them, and how to phrase a failure to
// someone who thinks they uploaded a spreadsheet, not an archive.
//
// Scope: handles the common shape produced by Excel, Google Sheets, Numbers,
// and most exporters — shared strings, inline strings, and numeric cells. It is
// deliberately tolerant, not a full OOXML implementation.
//
// Hardening: a hostile or corrupt workbook must not be able to exhaust memory.
// We only ever inflate the two parts we need, cap the total inflated bytes
// (decompression-bomb guard), and bound the row/column counts. The ZIP-level
// guards — bounds-checked offsets, ZIP64 refusal — come from lib/zip.ts.
import { ZipError, createBudget, readZipEntries, readZipEntry, type ByteBudget, type ZipEntry } from "./zip";

// ─── Resource limits ───────────────────────────────────────────────────────────

/** Hard ceiling on bytes we will inflate across all parts of one workbook. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024; // 64 MB
/** Excel's own maximums — anything beyond this is malformed, not legitimate. */
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384; // column XFD

// ─── Excel-facing wrappers over the ZIP layer ─────────────────────────────────

// lib/zip.ts speaks about archives; this file's callers uploaded a spreadsheet.
// Map each failure onto wording that tells them what to do about it.
const EXCEL_MESSAGE: Record<string, string> = {
  "not-zip": "Not a valid Excel workbook (no ZIP directory found).",
  zip64: "This Excel workbook uses ZIP64, which isn't supported. Please export as CSV.",
  truncated: "Corrupt Excel workbook (entry runs past end of file).",
  "bad-header": "Corrupt Excel workbook (bad local header).",
  "too-large": "This Excel workbook is too large to process safely. Please export a smaller CSV.",
  "no-decompressor": "This runtime cannot read compressed Excel workbooks. Please export as CSV.",
};

function asExcelError(err: unknown): unknown {
  if (!(err instanceof ZipError)) return err;
  const message =
    EXCEL_MESSAGE[err.code] ?? `Unsupported compression in Excel workbook (${err.message}).`;
  return new Error(message);
}

function entriesOf(view: DataView): ZipEntry[] {
  try {
    return readZipEntries(view);
  } catch (err) {
    throw asExcelError(err);
  }
}

async function readEntry(view: DataView, entry: ZipEntry, budget: ByteBudget): Promise<Uint8Array> {
  try {
    return await readZipEntry(view, entry, budget);
  } catch (err) {
    throw asExcelError(err);
  }
}

// ─── XML helpers ───────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Concatenate all <t>…</t> text inside a chunk (handles rich-text runs).
function textOf(chunk: string): string {
  let out = "";
  const re = /<t[^>]*>([\s\S]*?)<\/t>|<t\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) out += m[1] ?? "";
  return decodeXmlEntities(out);
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(textOf(m[1]));
  return out;
}

// Convert an A1-style column reference to a 0-based column index. Returns -1 for
// references beyond Excel's real maximum (which are malformed, not legitimate)
// so the caller can skip them without allocating a giant sparse row.
function colToIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  if (letters.length === 0 || letters.length > 3) return -1;
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  const idx = n - 1;
  return idx >= 0 && idx < MAX_COLS ? idx : -1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
    if (rows.length >= MAX_ROWS) {
      throw new Error("This worksheet has more rows than can be processed. Please split it into smaller files.");
    }
    const body = rm[1] ?? "";
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;

    while ((cm = cellRe.exec(body)) !== null) {
      const attrs = cm[1] ?? "";
      const inner = cm[2] ?? "";
      const rMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const tMatch = /t="([^"]+)"/.exec(attrs);
      const type = tMatch ? tMatch[1] : "n";

      let value = "";
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const idx = v ? parseInt(v[1], 10) : NaN;
        value = Number.isFinite(idx) ? shared[idx] ?? "" : "";
      } else if (type === "inlineStr") {
        value = textOf(inner);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = v ? decodeXmlEntities(v[1]) : "";
      }

      // Explicit column ref places the cell; a malformed/oversized ref is
      // skipped rather than allowed to allocate an enormous gap.
      const col = rMatch ? colToIndex(rMatch[1]) : cells.length;
      if (col < 0 || col >= MAX_COLS) continue;
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    rows.push(cells);
  }

  // Trim trailing fully-empty rows.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse the bytes of an .xlsx workbook into a matrix of string cells from the
 * first worksheet. Numeric cells are returned as their raw string form.
 * Throws a human-readable Error if the file is not a readable workbook or would
 * consume unsafe amounts of memory.
 */
export async function xlsxToRows(
  bytes: Uint8Array,
  opts: { maxInflatedBytes?: number } = {},
): Promise<string[][]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = entriesOf(view);
  const byName = new Map(entries.map((e) => [e.name, e]));

  // Shared byte budget across every part we inflate (decompression-bomb guard).
  const budget = createBudget(opts.maxInflatedBytes ?? MAX_INFLATED_BYTES);

  const dec = new TextDecoder("utf-8");
  const readXml = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    if (!e) return null;
    return dec.decode(await readEntry(view, e, budget));
  };

  // Shared strings are optional (inline-string workbooks omit them).
  const sharedXml = await readXml("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  // Prefer sheet1.xml, else the first worksheet part we can find.
  let sheetName = "xl/worksheets/sheet1.xml";
  if (!byName.has(sheetName)) {
    const first = entries.find((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name));
    if (!first) throw new Error("This Excel workbook has no readable worksheet.");
    sheetName = first.name;
  }
  const sheetXml = await readXml(sheetName);
  if (!sheetXml) throw new Error("This Excel workbook has no readable worksheet.");

  return parseSheet(sheetXml, shared);
}

/** Serialize a row matrix back to CSV text so it can flow through CSV pipelines. */
export function rowsToCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
