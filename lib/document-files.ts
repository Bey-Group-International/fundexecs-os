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

/**
 * Per-file ceiling for library uploads.
 *
 * Two limits sit between a file and the bucket: the `documents` bucket's own
 * `file_size_limit` (500 MB, migration 20260930200000) and the Supabase
 * project's GLOBAL upload limit, which the bucket can never exceed. On the Free
 * plan that global limit is fixed at 50 MB; paid plans can raise it.
 *
 * So the default here is the Free-plan truth, and NEXT_PUBLIC_DOCUMENT_MAX_UPLOAD_MB
 * raises it (up to the bucket's 500 MB) once the project is upgraded and its
 * global limit raised to match — see docs/DOCUMENT_UPLOAD_LIMIT.md. A drop zone
 * that promises more than Storage accepts fails at the last step; one that
 * states the real number refuses the file before anything is sent.
 */
export const FREE_PLAN_UPLOAD_MB = 50;
export const BUCKET_UPLOAD_MB = 500;

export const MAX_UPLOAD_BYTES = resolveMaxUploadBytes(process.env.NEXT_PUBLIC_DOCUMENT_MAX_UPLOAD_MB);

/** Parse the env override, clamped to the bucket; anything unusable is the Free-plan limit. */
export function resolveMaxUploadBytes(raw: string | undefined): number {
  const mb = Number(raw);
  const value = Number.isFinite(mb) && mb > 0 ? Math.min(mb, BUCKET_UPLOAD_MB) : FREE_PLAN_UPLOAD_MB;
  return Math.floor(value * 1024 * 1024);
}

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
  // Recorded walkthroughs and pitch videos. Large, which is why uploads are
  // resumable; played in the viewer rather than downloaded.
  { ext: ".mp4", label: "Video", mimeTypes: ["video/mp4"] },
  { ext: ".mov", label: "Video", mimeTypes: ["video/quicktime"] },
];

const BY_EXT = new Map(DOCUMENT_FILE_TYPES.map((t) => [t.ext, t]));

/** `accept` attribute for the library's file input. */
export const ACCEPTED_DOCUMENT_ATTR = DOCUMENT_FILE_TYPES.map((t) => t.ext).join(",");

/** The one rejection sentence the whole upload path uses. */
export const UNSUPPORTED_DOCUMENT_MESSAGE =
  "That file type can't be stored in the library. Upload a PDF, Office document, text file, image, or video (.mp4, .mov).";

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

/**
 * Canonical MIME type for a filename or storage key, from its extension.
 *
 * Uploads are stored under this rather than whatever the browser reported: a
 * file rebuilt from a zip entry has no type at all, and a machine without Office
 * reports an .xlsx as application/octet-stream. Stored as octet-stream, a PDF
 * downloads instead of opening in the viewer.
 */
export function mimeTypeForName(name: string): string {
  return BY_EXT.get(fileExtension(name))?.mimeTypes[0] ?? "application/octet-stream";
}

/** How the in-app viewer can show a file. */
export type PreviewKind = "pdf" | "image" | "video" | "office" | "text" | "none";

const OFFICE_EXTS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf"]);
const TEXT_EXTS = new Set([".txt", ".md", ".csv"]);

/**
 * PDFs, raster images and video render natively in the browser. Office formats
 * render from the text layer we extract (`document_texts.preview`). SVG is
 * deliberately `none`: it can carry script, so it is only ever downloaded.
 */
export function previewKindFor(storageKey: string | null | undefined): PreviewKind {
  if (!storageKey || isExternalLink(storageKey)) return "none";
  const ext = fileExtension(storageKey);
  if (ext === ".pdf") return "pdf";
  if (ext === ".mp4" || ext === ".mov") return "video";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  if (OFFICE_EXTS.has(ext)) return "office";
  if (TEXT_EXTS.has(ext)) return "text";
  return "none";
}

/** Whether Earn can pull a text layer out of this file. */
export function isExtractable(storageKey: string | null | undefined): boolean {
  if (!isUploadedFile(storageKey)) return false;
  const ext = fileExtension(storageKey as string);
  return ext === ".pdf" || [".docx", ".xlsx", ".pptx"].includes(ext) || TEXT_EXTS.has(ext);
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

/**
 * Result of minting an upload ticket (components/documents/upload-actions).
 * The ticket names the path; the bytes go up over resumable (TUS) upload under
 * the operator's own session, so Storage's writer-only RLS applies to the write
 * itself rather than being bypassed by a service-signed URL.
 */
export type UploadTicket =
  | { ok: true; documentId: string; path: string; contentType: string }
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
