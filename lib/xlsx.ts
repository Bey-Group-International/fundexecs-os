// lib/xlsx.ts
//
// Minimal, dependency-free XLSX → rows reader. An .xlsx file is a ZIP archive
// of XML parts; we read the ZIP central directory, inflate the worksheet and
// shared-strings parts, and flatten the first sheet into a string matrix that
// the existing CSV pipelines can consume.
//
// Isomorphic and dependency-free: raw DEFLATE is inflated with the standard
// `DecompressionStream` Web API, available both in browsers and in Node 18+.
//
// Scope: handles the common shape produced by Excel, Google Sheets, Numbers,
// and most exporters — STORE (method 0) and DEFLATE (method 8) entries, shared
// strings, inline strings, and numeric cells. It is deliberately tolerant, not
// a full OOXML implementation.

// ─── Inflate (Web Streams) ─────────────────────────────────────────────────────

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This runtime cannot read compressed Excel workbooks. Please export as CSV.");
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// ─── ZIP central-directory reader ──────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number; // 0 = store, 8 = deflate
  offset: number; // local header offset
  compressedSize: number;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

function readZipEntries(view: DataView): ZipEntry[] {
  const len = view.byteLength;

  // Locate the End Of Central Directory record by scanning backwards (its
  // trailing comment is almost always empty, so it sits near the very end).
  let eocd = -1;
  for (let i = len - 22; i >= 0 && i >= len - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid Excel workbook (no ZIP directory found).");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory offset

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && ptr + 46 <= len; i++) {
    if (view.getUint32(ptr, true) !== CDH_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const offset = view.getUint32(ptr + 42, true);

    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + ptr + 46, nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes);
    entries.push({ name, method, offset, compressedSize });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(view: DataView, entry: ZipEntry): Promise<Uint8Array> {
  // Local file header: name/extra lengths can differ from the central header,
  // so read them here to find the true data offset.
  const lh = entry.offset;
  if (view.getUint32(lh, true) !== 0x04034b50) throw new Error("Corrupt Excel workbook (bad local header).");
  const nameLen = view.getUint16(lh + 26, true);
  const extraLen = view.getUint16(lh + 28, true);
  const dataStart = lh + 30 + nameLen + extraLen;
  const compressed = new Uint8Array(view.buffer, view.byteOffset + dataStart, entry.compressedSize);

  if (entry.method === 0) return compressed.slice(); // stored
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`Unsupported compression in Excel workbook (method ${entry.method}).`);
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

// Convert an A1-style column reference to a 0-based column index.
function colToIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
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
      } else if (type === "str") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = v ? decodeXmlEntities(v[1]) : "";
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = v ? decodeXmlEntities(v[1]) : "";
      }

      const col = rMatch ? colToIndex(rMatch[1]) : cells.length;
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
 * Throws a human-readable Error if the file is not a readable workbook.
 */
export async function xlsxToRows(bytes: Uint8Array): Promise<string[][]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readZipEntries(view);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const dec = new TextDecoder("utf-8");
  const readXml = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    if (!e) return null;
    return dec.decode(await readEntry(view, e));
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
