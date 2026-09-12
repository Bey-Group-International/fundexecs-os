// lib/document-files.ts
//
// Everything the Documents library needs to reason about an uploaded file,
// with no Node- or browser-only imports so the same rules run in the drop zone,
// in the server action that mints the upload ticket, and in the route handlers
// that serve the bytes back out.
//
// `lib/file-validation.ts` is deliberately not reused here: it exists to gate
// SPREADSHEET INGESTION (CSV/XLSX only, because something downstream parses the
// rows). A data room is the opposite problem — the file is carried, not parsed,
// so the allowlist is wide and the checks are about identity and size rather
// than about whether a parser can read it.

/** Storage bucket holding library files. Private; every read is signed. */
export const DOCUMENT_BUCKET = "documents";

/** Matches the bucket's own `file_size_limit` (migration 20260912120000). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface DocumentFileType {
  /** Lowercased extension including the dot. */
  ext: string;
  /** How the library labels it in the Kind column. */
  label: string;
  /** MIME types browsers and OSes commonly report for this format. */
  mimeTypes: string[];
}

// The paper an institutional data room actually carries: offering and legal
// documents, financials, decks, and the scans and images that accompany them.
// Executables, archives, and anything a browser would run are absent by design
// — a document room is not a file transfer service.
export const DOCUMENT_FILE_TYPES: DocumentFileType[] = [
  { ext: ".pdf", label: "PDF", mimeTypes: ["application/pdf"] },
  {
    ext: ".doc",
    label: "Word",
    mimeTypes: ["application/msword"],
  },
  {
    ext: ".docx",
    label: "Word",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  { ext: ".xls", label: "Excel", mimeTypes: ["application/vnd.ms-excel"] },
  {
    ext: ".xlsx",
    label: "Excel",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  { ext: ".ppt", label: "Slides", mimeTypes: ["application/vnd.ms-powerpoint"] },
  {
    ext: ".pptx",
    label: "Slides",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  { ext: ".csv", label: "CSV", mimeTypes: ["text/csv", "application/csv"] },
  { ext: ".txt", label: "Text", mimeTypes: ["text/plain"] },
  { ext: ".md", label: "Markdown", mimeTypes: ["text/markdown", "text/plain"] },
  { ext: ".rtf", label: "Rich text", mimeTypes: ["application/rtf", "text/rtf"] },
  { ext: ".png", label: "Image", mimeTypes: ["image/png"] },
  { ext: ".jpg", label: "Image", mimeTypes: ["image/jpeg"] },
  { ext: ".jpeg", label: "Image", mimeTypes: ["image/jpeg"] },
  { ext: ".gif", label: "Image", mimeTypes: ["image/gif"] },
  { ext: ".webp", label: "Image", mimeTypes: ["image/webp"] },
  { ext: ".svg", label: "Image", mimeTypes: ["image/svg+xml"] },
];

const BY_EXT = new Map(DOCUMENT_FILE_TYPES.map((t) => [t.ext, t]));

/** `accept` attribute for the library's file input. */
export const ACCEPTED_DOCUMENT_ATTR = DOCUMENT_FILE_TYPES.map((t) => t.ext).join(",");

/** The one rejection sentence the whole upload path uses. */
export const UNSUPPORTED_DOCUMENT_MESSAGE =
  "That file type can't be stored in the library. Upload a PDF, Office document, text file, or image.";

/** Lowercased extension of a filename or storage key, including the dot. */
export function fileExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot).toLowerCase();
}

/**
 * Whether a `documents.storage_key` is an external link rather than an object
 * in our bucket. Links are the pre-upload shape and still supported: a document
 * may live in the firm's Drive and simply be filed here.
 *
 * A storage key is a relative path, so it can never parse as an absolute
 * http(s) URL — which makes the URL parse itself the discriminator, rather than
 * a flag column that could disagree with the value beside it.
 */
export function isExternalLink(storageKey: string | null | undefined): boolean {
  if (!storageKey) return false;
  try {
    const u = new URL(storageKey);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether a `documents.storage_key` points at an object in our bucket. */
export function isUploadedFile(storageKey: string | null | undefined): boolean {
  return Boolean(storageKey) && !isExternalLink(storageKey);
}

/** Human label for the Kind column: "PDF", "Excel", "Link", "Written". */
export function documentKindLabel(
  storageKey: string | null | undefined,
  hasContent: boolean,
): string {
  if (isExternalLink(storageKey)) return "Link";
  if (storageKey) return BY_EXT.get(fileExtension(storageKey))?.label ?? "File";
  return hasContent ? "Written" : "Empty";
}

export type UploadCheck =
  | { ok: true; ext: string; label: string }
  | { ok: false; reason: string };

/**
 * Gate a file before anything is minted for it. Extension is authoritative:
 * browsers report MIME inconsistently (an .xlsx arrives as
 * application/octet-stream on plenty of machines), so a reported type that
 * disagrees with a supported extension is not grounds for rejection.
 */
export function checkUploadCandidate(file: {
  name: string;
  size: number;
  type?: string;
}): UploadCheck {
  const name = file.name.trim();
  if (!name) return { ok: false, reason: "That file has no name." };
  const ext = fileExtension(name);
  const spec = BY_EXT.get(ext);
  if (!spec) return { ok: false, reason: UNSUPPORTED_DOCUMENT_MESSAGE };
  if (file.size <= 0) return { ok: false, reason: "That file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    };
  }
  return { ok: true, ext, label: spec.label };
}

/**
 * Object path for a document's file: `${orgId}/${docId}/${uuid}${ext}`.
 *
 * The uploaded filename is deliberately NOT part of the path. It carries no
 * information the row does not already hold, and keeping it out means no
 * sanitiser stands between a user-supplied string and a storage path — nothing
 * to get wrong with a `../`, a control character, or a 300-character name.
 */
export function documentObjectPath(
  orgId: string,
  documentId: string,
  uuid: string,
  ext: string,
): string {
  return `${orgId}/${documentId}/${uuid}${ext}`;
}

/**
 * Whether a client-supplied path is the one we minted for this document. The
 * upload ticket names the path, but the client hands it back at finalize time,
 * so it is re-checked rather than trusted.
 */
export function isDocumentObjectPath(
  path: string,
  orgId: string,
  documentId: string,
): boolean {
  if (path.includes("..") || path.startsWith("/")) return false;
  const segments = path.split("/");
  if (segments.length !== 3) return false;
  const [org, doc, file] = segments;
  if (org !== orgId || doc !== documentId) return false;
  if (!file || file.startsWith(".")) return false;
  return BY_EXT.has(fileExtension(file));
}

/** Byte count as an operator would read it. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Document name to file the upload under: the filename without its extension,
 * with separators turned back into spaces. `Q3_2026-audited-financials.pdf`
 * becomes `Q3 2026 audited financials` rather than being filed verbatim.
 */
export function documentNameFromFile(fileName: string): string {
  const base = (fileName.split("/").pop() ?? fileName).trim();
  const ext = fileExtension(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const cleaned = stem.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || base || "Untitled document").slice(0, 200);
}

/** Result of minting an upload ticket (components/documents/upload-actions). */
export type UploadTicket =
  | { ok: true; documentId: string; path: string; token: string }
  | { ok: false; error: string };

/** Result of finalizing or abandoning an upload. */
export type UploadOutcome = { ok: true } | { ok: false; error: string };

/**
 * Filename to hand a browser when it saves an uploaded document. Objects are
 * stored under a uuid, so without this every download lands in the reader's
 * folder as `9f3c…-7a1.pdf`.
 */
export function downloadFileName(name: string, storageKey: string): string {
  const ext = fileExtension(storageKey);
  const stem = name.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim() || "document";
  return stem.toLowerCase().endsWith(ext) ? stem : `${stem}${ext}`;
}
