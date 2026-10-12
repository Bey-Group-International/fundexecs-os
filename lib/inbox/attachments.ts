// lib/inbox/attachments.ts
// Files on an inbox reply: what the composer sends the server, and the rules
// the server applies to it. Pure — shared by the composer and the send path.
//
// Two sources: a file uploaded from the computer (into the private
// `inbox-attachments` bucket, see the migration), or a document already in the
// library. A data-room link is not an attachment at all: it is minted on demand
// and written into the message text, where the recipient sees it.

export const INBOX_ATTACHMENT_BUCKET = "inbox-attachments";

/** The largest single file the composer accepts (the bucket's own ceiling). */
export const MAX_ATTACHMENT_FILE_BYTES = 100 * 1024 * 1024;

/** How many files one message may carry. */
export const MAX_ATTACHMENTS = 10;

/** How long the download link for a file too big to attach stays alive. */
export const ATTACHMENT_LINK_DAYS = 7;

export type AttachmentRef =
  | { kind: "upload"; path: string; name: string; size: number; mimeType: string }
  | { kind: "document"; documentId: string; name: string; size: number; mimeType: string };

/** What a sent message records of each file, for the transcript. */
export interface SentAttachment {
  name: string;
  size: number;
  /** Attached to the email, or sent as a download link because it was too big. */
  delivery: "attached" | "link";
}

/** `<org>/<uuid>/<name>` — and nothing that could climb out of the org's prefix. */
export function attachmentPath(orgId: string, id: string, fileName: string): string {
  const safe = fileName.replace(/[\\/\u0000-\u001f]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "file";
  return `${orgId}/${id}/${safe}`;
}

export function isOrgAttachmentPath(orgId: string, path: string): boolean {
  const parts = path.split("/");
  // Exactly three segments, so a ".." inside a file name cannot climb anywhere;
  // only a segment that IS "." or ".." could.
  return (
    parts.length === 3 &&
    parts[0] === orgId &&
    /^[0-9a-f-]{36}$/i.test(parts[1]) &&
    Boolean(parts[2]) &&
    parts[2] !== "." &&
    parts[2] !== ".."
  );
}

/** Parse and bound the composer's list; anything malformed is dropped. */
export function parseAttachmentRefs(raw: unknown): AttachmentRef[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: AttachmentRef[] = [];
  for (const v of value.slice(0, MAX_ATTACHMENTS)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.slice(0, 200) : "";
    const size = typeof r.size === "number" && r.size >= 0 ? r.size : 0;
    const mimeType = typeof r.mimeType === "string" && r.mimeType ? r.mimeType.slice(0, 120) : "application/octet-stream";
    if (r.kind === "upload" && typeof r.path === "string" && name) out.push({ kind: "upload", path: r.path, name, size, mimeType });
    else if (r.kind === "document" && typeof r.documentId === "string" && name) {
      out.push({ kind: "document", documentId: r.documentId, name, size, mimeType });
    }
  }
  return out;
}

/**
 * Which files go in the email and which go as links: smallest first, attached
 * while the running total stays under the limit, linked after that — so one
 * big deck does not push every small file out of the message with it.
 */
export function splitBySize<T extends { size: number }>(files: readonly T[], limit: number): { attach: T[]; link: T[] } {
  const attach: T[] = [];
  const link: T[] = [];
  let total = 0;
  for (const f of [...files].sort((a, b) => a.size - b.size)) {
    if (total + f.size <= limit) {
      attach.push(f);
      total += f.size;
    } else link.push(f);
  }
  return { attach, link };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The lines a message gains for files sent as links. */
export function linkedFilesText(files: ReadonlyArray<{ name: string; size: number; url: string }>): string {
  if (!files.length) return "";
  return [
    "",
    `Files (download links, valid ${ATTACHMENT_LINK_DAYS} days):`,
    ...files.map((f) => `• ${f.name} (${formatFileSize(f.size)}): ${f.url}`),
  ].join("\n");
}
