// lib/zip.ts
//
// Minimal, dependency-free ZIP reader: central directory in, entry bytes out.
//
// Extracted from lib/xlsx.ts, which needed exactly this to read an .xlsx (a ZIP
// of XML parts) and grew a hardened reader in the process. Importing a zip of
// documents needs the same reader, and a second copy of code this fiddly — ZIP64
// sentinels, local-vs-central header disagreement, decompression bombs — is a
// second place for it to be subtly wrong. So it lives here and xlsx.ts consumes
// it, wrapping the errors in its own Excel-specific phrasing.
//
// Isomorphic and dependency-free: raw DEFLATE is inflated with the standard
// `DecompressionStream` Web API, available both in browsers and in Node 18+.
//
// Scope: STORE (method 0) and DEFLATE (method 8) entries, ZIP32 only. It is
// deliberately tolerant of trailing junk and odd extra fields, and deliberately
// refuses anything it cannot read exactly rather than guessing.
//
// Hardening: a hostile or corrupt archive must not be able to exhaust memory.
// Every read is byte-budgeted, every offset is bounds-checked against the
// buffer, and ZIP64 is refused rather than misread.

/** Why a zip could not be read. Callers map these to their own wording. */
export type ZipErrorCode =
  | "not-zip"
  | "zip64"
  | "truncated"
  | "bad-header"
  | "unsupported-method"
  | "too-large"
  | "no-decompressor";

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

export interface ZipEntry {
  /** Full path within the archive, as stored. */
  name: string;
  /** 0 = store, 8 = deflate. */
  method: number;
  /** Local header offset. */
  offset: number;
  compressedSize: number;
  /** Declared inflated size. A claim from the archive, not yet verified. */
  uncompressedSize: number;
  /** Directory entries carry no data and exist only to record the tree. */
  isDirectory: boolean;
}

/** A running byte allowance shared across reads, so a bomb cannot expand past it. */
export interface ByteBudget {
  remaining: number;
}

export function createBudget(maxBytes: number): ByteBudget {
  return { remaining: maxBytes };
}

/** ZIP32 uses 0xFFFFFFFF as the "see ZIP64 record" sentinel, which we don't support. */
const ZIP64_SENTINEL = 0xffffffff;
const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

// Inflate raw DEFLATE, aborting as soon as the running total would exceed the
// remaining budget so a small compressed entry can't expand without bound.
async function inflateRaw(bytes: Uint8Array, budget: ByteBudget): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError("no-decompressor", "This runtime cannot read compressed archives.");
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > budget.remaining) {
        await reader.cancel().catch(() => {});
        throw new ZipError("too-large", "This archive expands too large to process safely.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  budget.remaining -= total;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/**
 * Read the archive's central directory.
 *
 * Cheap: it touches only the directory at the end of the file, never the entry
 * data. That is what lets a caller show the contents of a 200 MB archive before
 * deciding to inflate any of it.
 */
export function readZipEntries(view: DataView): ZipEntry[] {
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
  if (eocd < 0) throw new ZipError("not-zip", "No ZIP directory found.");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory offset

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && ptr + 46 <= len; i++) {
    if (view.getUint32(ptr, true) !== CDH_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const offset = view.getUint32(ptr + 42, true);

    if (ptr + 46 + nameLen > len) break; // truncated central directory
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + ptr + 46, nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes);
    entries.push({
      name,
      method,
      offset,
      compressedSize,
      uncompressedSize,
      // A trailing slash is the only reliable directory marker across writers;
      // the external-attributes bits vary by platform.
      isDirectory: name.endsWith("/"),
    });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry's bytes, charged against the shared budget. */
export async function readZipEntry(
  view: DataView,
  entry: ZipEntry,
  budget: ByteBudget,
): Promise<Uint8Array> {
  const len = view.byteLength;

  if (entry.compressedSize === ZIP64_SENTINEL || entry.offset === ZIP64_SENTINEL) {
    throw new ZipError("zip64", "This archive uses ZIP64, which isn't supported.");
  }
  // Local file header: name/extra lengths can differ from the central header,
  // so read them here to find the true data offset. Bounds-check everything
  // against the buffer so a corrupt header can't read out of range.
  const lh = entry.offset;
  if (lh < 0 || lh + 30 > len) throw new ZipError("bad-header", "Bad local header offset.");
  if (view.getUint32(lh, true) !== LFH_SIG) throw new ZipError("bad-header", "Bad local header.");
  const nameLen = view.getUint16(lh + 26, true);
  const extraLen = view.getUint16(lh + 28, true);
  const dataStart = lh + 30 + nameLen + extraLen;
  if (dataStart + entry.compressedSize > len) {
    throw new ZipError("truncated", "Entry runs past end of file.");
  }

  const compressed = new Uint8Array(view.buffer, view.byteOffset + dataStart, entry.compressedSize);

  if (entry.method === 0) {
    // Stored: no inflation, but it still counts against the byte budget.
    if (entry.compressedSize > budget.remaining) {
      throw new ZipError("too-large", "This archive is too large to process safely.");
    }
    budget.remaining -= entry.compressedSize;
    return compressed.slice();
  }
  if (entry.method === 8) return inflateRaw(compressed, budget);
  throw new ZipError("unsupported-method", `Unsupported compression (method ${entry.method}).`);
}
