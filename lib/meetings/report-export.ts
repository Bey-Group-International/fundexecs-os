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
import { parseTranscript } from "@/lib/meetings/transcript-view";

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
  /**
   * Who was on the meeting.
   *
   * Loaded by `loadReportForExport` since it was written, and until now thrown
   * away by this builder — every exported report was a record of a conversation
   * that did not say who had it. Untyped because it comes out of a jsonb
   * column; `attendeeNames` is what makes it safe to read.
   */
  attendees?: unknown;
  /** The room code, which is the only stable human-quotable reference a meeting has. */
  roomCode?: string | null;
  /**
   * The meeting's recording, when it has one that can still be played.
   *
   * Named in the document rather than left to the report page. A filed record
   * that does not mention the recording is a record that loses it: the file is
   * deleted after its retention period, and somebody reading the export a month
   * later has no way to know it was ever there, let alone that it is going.
   */
  recording?: { url: string; expiresAt: string | null; durationSeconds: number | null } | null;
}

export interface ReportExportOptions {
  /** Append the verbatim transcript. Off unless the person asked for it. */
  includeTranscript?: boolean;
  /**
   * Open with the meeting's name as a heading.
   *
   * On by default, and off for the formats whose renderer draws the title
   * itself — see rendererDrawsTitle. Left on for those, the exported file
   * carries the name twice, one line under the other.
   */
  titleHeading?: boolean;
}

/**
 * Whether an exporter prints the title it is handed, rather than only filing
 * it as document metadata.
 *
 * RTF, DOCX and PDF draw it at the top of the first page. HTML puts it in
 * <head> and draws nothing, and markdown ignores the argument entirely — so
 * those two need the heading to come from the document itself.
 *
 * Stated here, next to the builder it governs, because the alternative is a
 * caller remembering it: this was originally missed, and the duplicate title
 * only showed up when somebody read a generated PDF.
 */
export function rendererDrawsTitle(format: string): boolean {
  return format === "rtf" || format === "docx" || format === "pdf";
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
 * Numbered, for the sections somebody will refer back to by number.
 *
 * "Action 3 is mine" is a sentence people say in the meeting after this one,
 * and they cannot say it about a bullet.
 */
function numbered(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

/**
 * The attendee names, from the meeting's jsonb column.
 *
 * Deliberately forgiving: this data has been through a directory resolution
 * step and several schema versions, and an attendee stored oddly is still
 * somebody who was in the room. An entry with nothing usable is dropped rather
 * than rendered as an empty line in a filed document.
 */
export function attendeeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name && !names.includes(name)) names.push(name);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { name?: unknown; email?: unknown };
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const email = typeof e.email === "string" ? e.email.trim() : "";
    // The address only when there is no name: "Rae Patel <rae@…>" in a filed
    // document is an address book entry, not a participant list.
    const label = name || email;
    if (label && !names.includes(label)) names.push(label);
  }
  return names;
}

/** A time of day, for the record block. Omitted when the meeting never started. */
function headerTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

/** One labelled fact in the record block, or nothing when there is no value. */
function fact(label: string, value: string | null): string | null {
  return value && value.trim() ? `- **${label}:** ${value.trim()}` : null;
}

/**
 * The transcript, as turns rather than as a wall.
 *
 * `parseTranscript` already exists for the report page, which renders the same
 * stored text as speaker turns; the exported file was getting the raw block
 * with one paragraph per utterance and the speaker's name glued to the front of
 * each. Reusing it means the document somebody files matches the page they
 * read, and consecutive lines from one speaker become one paragraph instead of
 * five.
 */
function transcriptSection(text: string): string {
  const turns = parseTranscript(text);
  if (!turns.length) return asParagraphs(text);
  return turns
    .map((turn) => {
      const who = turn.speaker
        ? `**${turn.speaker}**${turn.uncertain ? " *(attribution uncertain)*" : ""}`
        : "**Unattributed**";
      return [who, "", turn.paragraphs.join("\n\n")].join("\n");
    })
    .join("\n\n");
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
  const attendees = attendeeNames(input.attendees);

  const lines: string[] = options.titleHeading === false ? [] : [`# ${title}`, ""];

  // The record block. A filed document has to answer "which meeting is this"
  // before it says anything about what happened in it — a summary with no date,
  // no reference and nobody's name attached is a note, not a record.
  //
  // This replaces a single interpuncted line of date, length and sentiment.
  // Labelled facts rather than a table: the same markdown has to survive five
  // renderers, and a bulleted list is the richest structure all five agree on.
  const record = [
    fact("Date", headerDate(input.createdAt)),
    fact("Time", headerTime(input.startedAt)),
    fact("Duration", duration ? `${duration} minutes` : null),
    fact("Reference", input.roomCode ? input.roomCode.toUpperCase() : null),
    fact("Participants", attendees.length ? attendees.join(", ") : null),
    fact("Tone", sentiment ? sentiment.charAt(0).toUpperCase() + sentiment.slice(1) : null),
  ].filter(Boolean) as string[];

  if (record.length) lines.push(...section("Meeting Record", record.join("\n")));

  // The recording, stated with its expiry. A document that mentions a video
  // without saying it is being deleted invites somebody to rely on a link that
  // will stop working.
  const recording = recordingFacts(input.recording);
  if (recording) lines.push(...section("Recording", recording));

  // Decisions first, then what they commit somebody to, then the discussion
  // that produced them. The old order opened on Key Points, which buries the
  // two sections anybody rereads this document for under the one they do not.
  lines.push(
    ...section("Summary", normalizeNoteText(input.summary)),
    ...section("Decisions", numbered(decisions)),
    ...section("Action Items", numbered(actionItems)),
    ...section("Discussion", bullets(keyPoints)),
    ...section("Next Meeting", nextMeeting),
    ...section("Follow-up Draft", followUp),
  );

  if (options.includeTranscript && (input.fullTranscript ?? "").trim()) {
    lines.push(...section("Transcript", transcriptSection(input.fullTranscript ?? "")));
  }

  // Provenance. A document that leaves the building should say what produced
  // it and from what, so that a reader a year later knows whether they are
  // holding minutes somebody wrote or a summary a model made — and the line
  // below is the honest answer to that.
  lines.push(
    "---",
    "",
    `*Record generated by FundExecs from the meeting's own transcript${
      options.includeTranscript ? ", which is reproduced in full above" : ""
    }. Summaries, decisions and action items are model-generated and should be read as a starting point rather than as minutes.*`,
    "",
  );

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

/**
 * The recording block: where it is, how long it runs, and when it goes.
 *
 * Returns null when there is nothing to say. A "Recording" heading over the
 * words "not recorded" is worse than no heading — most meetings are not
 * recorded, and the majority of exports would carry it.
 */
function recordingFacts(
  recording: ReportExportInput["recording"],
): string | null {
  if (!recording?.url) return null;

  const minutes =
    typeof recording.durationSeconds === "number" && recording.durationSeconds > 0
      ? Math.max(1, Math.round(recording.durationSeconds / 60))
      : null;

  const facts = [
    fact("Watch", recording.url),
    fact("Length", minutes ? `${minutes} minutes` : null),
    fact("Available until", headerDate(recording.expiresAt ?? null)),
  ].filter(Boolean) as string[];

  return facts.length ? facts.join("\n") : null;
}
