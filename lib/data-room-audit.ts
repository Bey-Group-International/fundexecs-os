// lib/data-room-audit.ts
// Audit trail export for a data room. Compliance and ODD teams ask for the
// access log as a file they can archive — who opened the room, which documents
// they read, and for how long — so this turns the raw view rows into RFC 4180
// CSV. Pure: no database, no Response, just rows in and text out.

export interface AuditView {
  createdAt: string;
  kind: "room" | "document";
  shareId: string | null;
  documentId: string | null;
  viewerEmail: string | null;
  sessionId: string | null;
  durationSeconds: number | null;
}

export interface AuditShare {
  id: string;
  label: string | null;
  recipientEmail: string | null;
}

export interface AuditDoc {
  id: string;
  name: string;
}

export const AUDIT_COLUMNS = [
  "Timestamp (UTC)",
  "Event",
  "Link",
  "Recipient",
  "Viewer",
  "Document",
  "Duration (s)",
  "Session",
] as const;

/**
 * Escape one CSV field per RFC 4180: wrap in quotes when it contains a comma,
 * quote, CR or LF, and double any embedded quote.
 *
 * A leading =, +, - or @ is also prefixed with a quote character, because
 * spreadsheet software treats such a cell as a formula. Viewer emails and link
 * labels are attacker-influenced free text, so an exported log must not become
 * a live formula when a compliance officer opens it in Excel.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Join one row of already-raw values into a CSV line. */
export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(",");
}

/**
 * Build the audit CSV for a room. Rows are newest first — the order a reader
 * scanning for recent activity wants — and every view is resolved against its
 * link and document so the file reads without needing the database.
 */
export function buildAuditCsv(args: {
  roomName: string;
  views: AuditView[];
  shares: AuditShare[];
  docs: AuditDoc[];
  /** Older history exists beyond these rows. Stated in the file rather than
   * dropped silently — a log that looks complete but is not defeats the point. */
  truncated?: boolean;
}): string {
  const shareById = new Map(args.shares.map((s) => [s.id, s]));
  const docById = new Map(args.docs.map((d) => [d.id, d]));

  const sorted = [...args.views].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const lines = [csvRow([...AUDIT_COLUMNS])];
  for (const v of sorted) {
    const share = v.shareId ? shareById.get(v.shareId) : undefined;
    const doc = v.documentId ? docById.get(v.documentId) : undefined;
    lines.push(
      csvRow([
        v.createdAt,
        v.kind === "document" ? "Document opened" : "Room opened",
        share?.label ?? (v.shareId ? "(unlabelled link)" : ""),
        share?.recipientEmail ?? "",
        v.viewerEmail ?? "",
        doc?.name ?? (v.documentId ? "(deleted document)" : ""),
        v.durationSeconds ?? "",
        v.sessionId ?? "",
      ]),
    );
  }
  if (args.truncated) {
    lines.push(
      csvRow([
        "",
        `Truncated: older activity exists beyond these ${sorted.length} rows and is not included.`,
      ]),
    );
  }
  // RFC 4180 uses CRLF; Excel and Sheets both accept it.
  return lines.join("\r\n") + "\r\n";
}

/** Filename for the export: room name slugged, plus the date it was taken. */
export function auditFilename(roomName: string, now: Date = new Date()): string {
  const slug =
    roomName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "data-room";
  return `${slug}-audit-${now.toISOString().slice(0, 10)}.csv`;
}
