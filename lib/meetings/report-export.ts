// lib/meetings/report-export.ts
// The meeting report, as a document rather than a page.
//
// The report screen renders these fields as React. This renders the same
// fields as markdown, which every exporter in lib/artifacts/export already
// knows how to turn into RTF, HTML, DOCX or PDF. One shape, five formats, and
// the page and the file cannot drift apart because they read the same fields
// through the same normalizers.
//
// The transcript is deliberately opt-in. It is verbatim speech: long, and a
// different thing to hand somebody than a summary. Exporting it should be a
// decision, not a surprise discovered after the file is sent.
//
// Pure: no DOM, no Supabase, no model calls.

import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";

/** The report and its meeting, as the exporters need to see them. */
export interface ReportExportInput {
  title: string | null;
  createdAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  /** Model output, so `unknown` until normalized. */
  keyPoints: unknown;
  actionItems: unknown;
  analysis: Record<string, unknown> | null;
  fullTranscript: string | null;
}

export interface ReportExportOptions {
  /** Append the verbatim transcript. Off unless the person asked for it. */
  includeTranscript?: boolean;
}

/** What a meeting with no title is called, in a filename and in a heading. */
export const UNTITLED_MEETING = "Meeting";

/**
 * Wall-clock length of the meeting, or null when it never started or ended.
 *
 * Rounded to the minute because that is the only precision the report claims
 * anywhere else, and a report that said "47.3 min" would be inventing accuracy.
 */
export function meetingDurationMinutes(
  startedAt: string | null,
  endedAt: string | null,
): number | null {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  return minutes > 0 ? minutes : null;
}

/**
 * Whether there is anything worth exporting yet.
 *
 * The summary is the gate the report page already uses to tell "still
 * generating" from "done", so export answers the same way rather than handing
 * somebody a file with headings and nothing under them.
 */
export function hasExportableReport(input: ReportExportInput): boolean {
  return typeof input.summary === "string" && input.summary.trim().length > 0;
}

/** A date as the document header states it. Invalid or missing dates are omitted. */
function headerDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

/**
 * Each line its own paragraph.
 *
 * A transcript is a sequence of utterances, and markdown folds consecutive
 * lines into one paragraph — which would run every speaker together into a
 * wall of text the moment it reached a PDF.
 */
function asParagraphs(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** One markdown section, or nothing at all when the section is empty. */
function section(heading: string, body: string): string[] {
  return body.trim() ? [`## ${heading}`, "", body.trim(), ""] : [];
}

function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Render the report as markdown.
 *
 * Sections that have no content are left out entirely rather than printed
 * empty: a heading with nothing under it reads as something having gone wrong,
 * and plenty of meetings genuinely have no decisions or no action items.
 */
export function buildReportMarkdown(
  input: ReportExportInput,
  options: ReportExportOptions = {},
): string {
  const analysis = input.analysis ?? null;
  const keyPoints = normalizeNoteList(input.keyPoints);
  const actionItems = normalizeNoteList(input.actionItems);
  const decisions = normalizeNoteList(analysis?.decisions);
  const followUp = normalizeNoteText(analysis?.follow_up_draft);
  const nextMeeting = normalizeNoteText(analysis?.next_meeting_suggestion);
  const sentiment = normalizeNoteText(analysis?.sentiment);

  const title = (input.title ?? "").trim() || UNTITLED_MEETING;
  const duration = meetingDurationMinutes(input.startedAt, input.endedAt);

  // Date, length and tone on one line under the title — the things somebody
  // scanning a filed report wants before they read a word of it.
  const meta = [
    headerDate(input.createdAt),
    duration ? `${duration} min` : null,
    sentiment ? `Sentiment: ${sentiment}` : null,
  ].filter(Boolean).join(" · ");

  const lines: string[] = [`# ${title}`, ""];
  if (meta) lines.push(meta, "");

  lines.push(
    ...section("Summary", normalizeNoteText(input.summary)),
    ...section("Key Points", bullets(keyPoints)),
    ...section("Decisions", bullets(decisions)),
    ...section("Action Items", bullets(actionItems)),
    ...section("Next Meeting", nextMeeting),
    ...section("Follow-up Draft", followUp),
  );

  if (options.includeTranscript && (input.fullTranscript ?? "").trim()) {
    lines.push(...section("Full Transcript", asParagraphs(input.fullTranscript ?? "")));
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * A filename somebody can find again.
 *
 * Title first because that is what they remember, date second because that is
 * how they sort. Everything outside a conservative set is replaced rather than
 * stripped, so two meetings whose titles differ only in punctuation do not
 * collide in a downloads folder.
 */
export function reportExportFilename(
  title: string | null,
  createdAt: string | null,
  extension: string,
  options: ReportExportOptions = {},
): string {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "")
    .toLowerCase() || UNTITLED_MEETING.toLowerCase();

  const ms = createdAt ? Date.parse(createdAt) : NaN;
  const date = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
  const suffix = options.includeTranscript ? "-with-transcript" : "";

  const base = [slug, date].filter(Boolean).join("-");
  return `${base}${suffix}.${extension}`;
}
