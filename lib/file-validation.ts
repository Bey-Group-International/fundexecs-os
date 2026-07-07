// lib/file-validation.ts
//
// Reusable, dependency-free file-validation layer shared by every document
// upload surface (Network, Data Room, Marketplace, Operator, Allocator, …).
//
// Goals:
//   • Auto-detect a file's real type from MIME type + magic-byte signature,
//     never trusting the extension alone.
//   • Enforce the supported allowlist (CSV + XLSX) with one consistent,
//     human-readable message across the whole app.
//   • Catch extension/content mismatches (e.g. a `.csv` that is really an
//     Excel workbook, or an `.xlsx` that is really a text file).
//   • Parse CSV and normalize arbitrary spreadsheets into the institutional
//     ingestion format (consistent header naming, casing, ordering).
//
// This module is isomorphic — it holds no Node- or browser-only imports, so it
// can run in a Server Component, a route handler, or a "use client" component.
// XLSX *parsing* (which needs zip inflation) lives in `lib/xlsx.ts`; this file
// only needs the first few bytes to recognise the format.

// ─── Supported formats ─────────────────────────────────────────────────────────

export type FileKind = "csv" | "xlsx";

export interface FormatSpec {
  kind: FileKind;
  label: string;
  extensions: string[];
  /** MIME types browsers/OSes commonly report for this format. */
  mimeTypes: string[];
  /** Content family the magic-byte signature must belong to. */
  signature: SignatureKind;
}

/** Coarse content family inferred from the leading bytes of a file. */
export type SignatureKind = "zip" | "ole" | "text" | "binary" | "unknown";

export const SUPPORTED_FORMATS: FormatSpec[] = [
  {
    kind: "csv",
    label: "CSV",
    extensions: [".csv"],
    mimeTypes: [
      "text/csv",
      "application/csv",
      "text/plain",
      "application/vnd.ms-excel", // some OSes report this for .csv
      "",
    ],
    signature: "text",
  },
  {
    kind: "xlsx",
    label: "XLSX",
    extensions: [".xlsx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
      "application/zip",
      "",
    ],
    signature: "zip",
  },
];

/** `accept` attribute for `<input type="file">` on every upload surface. */
export const ACCEPTED_UPLOAD_ATTR =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Human list of accepted formats for tooltips / "View accepted formats" links. */
export const ACCEPTED_FORMATS_HELP: { label: string; hint: string }[] = [
  { label: "CSV (.csv)", hint: "Comma-separated values — export from any spreadsheet as CSV." },
  { label: "Excel (.xlsx)", hint: "Modern Excel workbook. Legacy .xls must be re-saved as .xlsx or CSV." },
];

// The single canonical rejection message the spec mandates.
export const UNSUPPORTED_FILE_MESSAGE =
  "This file type is not supported. Please upload a CSV or XLSX file.";

// ─── Magic-byte signatures ─────────────────────────────────────────────────────

// ZIP (also the container for .xlsx/.docx/.pptx): "PK\x03\x04" or the
// empty/spanned-archive variants "PK\x05\x06" / "PK\x07\x08".
const ZIP_SIGS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

// Legacy OLE2 compound file — old .xls / .doc: D0 CF 11 E0 A1 B1 1A E1.
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

/**
 * Classify the leading bytes of a file into a coarse content family. CSV has no
 * magic number, so anything that isn't a known binary container and decodes as
 * clean UTF-8 text is treated as `text`.
 */
export function detectSignature(bytes: Uint8Array): SignatureKind {
  if (bytes.length === 0) return "unknown";
  if (ZIP_SIGS.some((s) => startsWith(bytes, s))) return "zip";
  if (startsWith(bytes, OLE_SIG)) return "ole";

  // Heuristic text sniff over the sampled head: reject NUL bytes and a high
  // ratio of non-text control bytes (typical of binary formats).
  let control = 0;
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return "binary";
    // Allow tab (9), LF (10), CR (13); count other C0 control bytes.
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / n > 0.1 ? "binary" : "text";
}

// ─── Type detection ────────────────────────────────────────────────────────────

export interface FileDescriptor {
  name: string;
  /** Browser-/OS-reported MIME type (may be empty or wrong). */
  mime?: string;
  /** Leading bytes of the file, if available, for signature sniffing. */
  head?: Uint8Array;
}

export interface DetectionResult {
  /** Lowercased extension including the dot, e.g. ".csv" (or "" if none). */
  ext: string;
  /** Kind implied by the extension, if recognised. */
  byExtension: FileKind | null;
  /** Kind implied by the MIME type, if recognised (and unambiguous). */
  byMime: FileKind | null;
  /** Content family sniffed from the magic bytes (null if no bytes given). */
  signature: SignatureKind | null;
  /**
   * Best single guess of the real kind, preferring signature > extension.
   * Null when the file is not a supported format at all.
   */
  kind: FileKind | null;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function kindByExtension(ext: string): FileKind | null {
  const f = SUPPORTED_FORMATS.find((s) => s.extensions.includes(ext));
  return f ? f.kind : null;
}

function kindByMime(mime: string): FileKind | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (!m) return null;
  // Only accept a MIME hit when it maps to exactly one kind, so shared types
  // like application/vnd.ms-excel don't force a wrong answer.
  const matches = SUPPORTED_FORMATS.filter((s) => s.mimeTypes.includes(m));
  const kinds = new Set(matches.map((s) => s.kind));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/**
 * Detect a file's type from its name, MIME type, and (when available) its
 * leading bytes. The signature wins over the extension so a renamed file is
 * still classified by what it actually is.
 */
export function detectFileType(file: FileDescriptor): DetectionResult {
  const ext = extensionOf(file.name);
  const byExtension = kindByExtension(ext);
  const byMime = file.mime ? kindByMime(file.mime) : null;
  const signature = file.head ? detectSignature(file.head) : null;

  let kind: FileKind | null = null;
  if (signature === "zip") {
    // A ZIP container is only a supported upload when it claims to be .xlsx.
    kind = byExtension === "xlsx" || byMime === "xlsx" ? "xlsx" : null;
  } else if (signature === "text") {
    kind = byExtension === "csv" || byMime === "csv" || byExtension === null ? "csv" : byExtension;
  } else if (signature === "ole" || signature === "binary") {
    kind = null; // legacy / unknown binary — not supported
  } else {
    // No bytes to sniff: fall back to extension, then MIME.
    kind = byExtension ?? byMime;
  }

  return { ext, byExtension, byMime, signature, kind };
}

// ─── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  kind?: FileKind;
  /** User-facing, human-readable error (null when ok). */
  error: string | null;
  detection: DetectionResult;
}

export interface ValidateOptions {
  /** Restrict the allowlist to a subset of the supported kinds. */
  accept?: FileKind[];
}

/**
 * Validate a file against the supported allowlist, using signature detection to
 * catch extension/content mismatches. Returns a single user-facing message
 * describing exactly what to do next.
 */
export function validateFileType(file: FileDescriptor, opts: ValidateOptions = {}): ValidationResult {
  const accept = opts.accept ?? SUPPORTED_FORMATS.map((f) => f.kind);
  const detection = detectFileType(file);
  const { ext, byExtension, signature } = detection;

  const reject = (error: string): ValidationResult => ({ ok: false, error, detection });

  // 1. Extension must be one we support at all.
  if (byExtension === null) {
    if (signature === "zip" && (ext === ".xlsx" || accept.includes("xlsx"))) {
      // handled below
    } else {
      return reject(UNSUPPORTED_FILE_MESSAGE);
    }
  }

  // 2. Mismatch: a supported extension whose real content is something else.
  if (byExtension === "csv" && signature === "zip") {
    return reject(
      'This file is named ".csv" but is actually an Excel/ZIP file. Re-save it as CSV, or rename it to ".xlsx" and upload it as Excel.',
    );
  }
  if (byExtension === "csv" && (signature === "ole" || signature === "binary")) {
    return reject(
      'This file is named ".csv" but does not contain plain text. Open it in a spreadsheet and export a genuine CSV, then try again.',
    );
  }
  if (byExtension === "xlsx" && signature === "ole") {
    return reject(
      "This looks like a legacy Excel (.xls) file. Re-save it as .xlsx (Excel Workbook) or export it as CSV, then upload again.",
    );
  }
  if (byExtension === "xlsx" && signature === "text") {
    return reject(
      'This file is named ".xlsx" but is actually plain text. Rename it to ".csv" and upload it as CSV, or re-save it as a real Excel workbook.',
    );
  }
  if (byExtension === "xlsx" && signature === "binary") {
    return reject(
      "This does not appear to be a valid Excel workbook. Re-save it as .xlsx or export it as CSV, then upload again.",
    );
  }

  // 3. Resolve the effective kind and confirm it's in the accepted subset.
  const kind = detection.kind ?? byExtension;
  if (kind === null) return reject(UNSUPPORTED_FILE_MESSAGE);
  if (!accept.includes(kind)) {
    const list = accept.map((k) => SUPPORTED_FORMATS.find((f) => f.kind === k)?.label ?? k).join(" or ");
    return reject(`This upload accepts only ${list} files. Please convert your file and try again.`);
  }

  return { ok: true, kind, error: null, detection };
}

// ─── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Parse CSV text into a matrix of trimmed-but-verbatim cells, honouring quoted
 * fields, escaped (`""`) quotes, and embedded newlines (RFC 4180). Fully blank
 * rows are dropped. A leading UTF-8 BOM is stripped.
 */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (ch === "\r" && next === "\n") i++;
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// ─── Institutional normalization ───────────────────────────────────────────────

export interface SchemaField {
  /** Canonical internal key, e.g. "first_name". */
  key: string;
  /** Human label used in messages and headers, e.g. "First Name". */
  label: string;
  /** Alternate header spellings to auto-map from (case/spacing-insensitive). */
  aliases?: string[];
  /** When true, a missing column or an all-empty column is an error. */
  required?: boolean;
}

export interface NormalizeResult {
  /** Schema keys that were successfully mapped, in institutional order. */
  columns: string[];
  /** Schema key → source column index. */
  mapping: Record<string, number>;
  /** Source headers that did not map to any schema field. */
  unmappedHeaders: string[];
  /** Normalized rows as objects keyed by schema key (institutional order). */
  records: Record<string, string>[];
  /** Normalized matrix reordered to institutional column order. */
  matrix: string[][];
  /** Institutional header row (labels) matching `matrix` columns. */
  header: string[];
  /** Blocking, user-facing problems (missing required fields, etc.). */
  errors: string[];
  /** Non-blocking notes (unmapped columns, dropped blank rows, etc.). */
  warnings: string[];
}

/** Canonicalize a header/alias for tolerant matching. */
function canonical(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalize a parsed spreadsheet (header row + data rows) into the institutional
 * ingestion format: auto-map source columns to the internal schema, validate
 * required fields, and reorder columns/rows to the schema's canonical order.
 *
 * `rows[0]` is treated as the header row; the rest are data.
 */
export function normalizeInstitutionalFormat(rows: string[][], schema: SchemaField[]): NormalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    return {
      columns: [], mapping: {}, unmappedHeaders: [], records: [], matrix: [], header: [],
      errors: ["The file is empty — no header row was found."], warnings: [],
    };
  }

  const rawHeaders = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) warnings.push("The file has a header row but no data rows.");

  // Build a lookup from canonical source header → column index (first wins).
  const headerIndex = new Map<string, number>();
  rawHeaders.forEach((h, i) => {
    const c = canonical(h);
    if (c && !headerIndex.has(c)) headerIndex.set(c, i);
  });

  const mapping: Record<string, number> = {};
  const columns: string[] = [];
  const usedIdx = new Set<number>();

  for (const field of schema) {
    const candidates = [field.key, field.label, ...(field.aliases ?? [])].map(canonical);
    let idx = -1;
    for (const cand of candidates) {
      if (headerIndex.has(cand)) {
        idx = headerIndex.get(cand)!;
        break;
      }
    }
    if (idx >= 0) {
      mapping[field.key] = idx;
      columns.push(field.key);
      usedIdx.add(idx);
    } else if (field.required) {
      errors.push(`Required column "${field.label}" is missing. Add a "${field.label}" column and re-upload.`);
    }
  }

  const unmappedHeaders = rawHeaders.filter((_, i) => !usedIdx.has(i) && rawHeaders[i] !== "");
  if (unmappedHeaders.length) {
    warnings.push(`Ignored ${unmappedHeaders.length} unrecognized column(s): ${unmappedHeaders.join(", ")}.`);
  }

  // Build normalized records + matrix in institutional (schema) order.
  const orderedFields = schema.filter((f) => columns.includes(f.key));
  const header = orderedFields.map((f) => f.label);
  const records: Record<string, string>[] = [];
  const matrix: string[][] = [];

  // Track which required fields have at least one non-empty value.
  const requiredKeys = schema.filter((f) => f.required && columns.includes(f.key)).map((f) => f.key);
  const seenValue = new Set<string>();

  for (const row of dataRows) {
    const rec: Record<string, string> = {};
    const line: string[] = [];
    for (const field of orderedFields) {
      const v = (row[mapping[field.key]] ?? "").trim();
      rec[field.key] = v;
      line.push(v);
      if (v !== "" && requiredKeys.includes(field.key)) seenValue.add(field.key);
    }
    // Drop rows that are entirely empty across the mapped columns.
    if (line.some((c) => c !== "")) {
      records.push(rec);
      matrix.push(line);
    }
  }

  for (const key of requiredKeys) {
    if (!seenValue.has(key)) {
      const label = schema.find((f) => f.key === key)?.label ?? key;
      errors.push(`Required column "${label}" is present but every row is empty.`);
    }
  }

  return { columns, mapping, unmappedHeaders, records, matrix, header, errors, warnings };
}

// ─── User-facing error handling ────────────────────────────────────────────────

export interface UserFacingError {
  /** Stable machine code for logs/telemetry. */
  code: string;
  /** Human-readable message safe to show inline near the upload control. */
  message: string;
  /** Optional field/column the error relates to. */
  field?: string;
}

/**
 * Aggregate raw problems into a consistent, human-readable payload and log the
 * detail for debugging — without throwing, so the rest of the UI keeps working.
 * Returns `null` when there are no errors.
 */
export function returnUserFacingErrors(
  errors: (string | UserFacingError)[],
  context = "upload",
): { message: string; errors: UserFacingError[] } | null {
  if (!errors.length) return null;

  const normalized: UserFacingError[] = errors.map((e) =>
    typeof e === "string" ? { code: "validation_error", message: e } : e,
  );

  // Log for debugging; never let logging failures bubble into the UI.
  try {
    console.warn(`[file-validation:${context}]`, normalized.map((e) => e.message).join(" | "));
  } catch {
    /* no-op */
  }

  const message =
    normalized.length === 1
      ? normalized[0].message
      : `We found ${normalized.length} problems with this file:\n• ${normalized.map((e) => e.message).join("\n• ")}`;

  return { message, errors: normalized };
}

// ─── Browser helper ────────────────────────────────────────────────────────────

/**
 * Read the first `n` bytes of a browser `File`/`Blob` for signature sniffing.
 * Returns an empty array in non-browser contexts where `slice`/`arrayBuffer`
 * are unavailable.
 */
export async function readFileHead(file: Blob, n = 512): Promise<Uint8Array> {
  try {
    const slice = file.slice(0, n);
    const buf = await slice.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return new Uint8Array();
  }
}
