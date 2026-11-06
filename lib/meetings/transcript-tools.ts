// lib/meetings/transcript-tools.ts
// What can be done with a meeting's transcript after the meeting: put real
// names on "Speaker 2", correct a misheard line without losing what was
// heard, see who did the talking, and take the transcript away in the format
// the next tool wants.
//
// Corrections and names are an overlay. The rows the room wrote while people
// spoke are never rewritten: an edit is stored beside its line, a name beside
// the label it replaces, and both are applied when the transcript is read. So
// the original is always one click away, and undoing an edit is deleting it.
//
// Pure. The overlay is loaded by whoever renders, and applied here.

import type { CueRow } from "@/lib/meetings/transcript-cues";
import { parseTranscript } from "@/lib/meetings/transcript-view";

export const SPEAKER_NAME_MAX = 80;
export const LINE_TEXT_MAX = 4_000;

/** A row as the overlay sees it: a stored line, with its id when the reader selected one. */
export type OverlayRow = CueRow & { id?: string | null };

/** A row once the overlay has been applied. */
export type ShownRow = OverlayRow & {
  /** The words as heard, when they have been corrected. */
  original?: string;
  /** The speaker label as heard, when it has been renamed. */
  originalSpeaker?: string;
};

export interface TranscriptOverlay {
  /** Speaker label as heard → the name to show. */
  names: ReadonlyMap<string, string>;
  /** Line id → corrected text. */
  edits: ReadonlyMap<string, string>;
}

export const EMPTY_OVERLAY: TranscriptOverlay = { names: new Map(), edits: new Map() };

/** One line, no control characters, capped; null for nothing. */
export function cleanSpeakerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPEAKER_NAME_MAX)
    .trim();
  return t || null;
}

/** A corrected line: trimmed, whitespace kept tidy, capped; null for nothing. */
export function cleanLineText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, LINE_TEXT_MAX)
    .trim();
  return t || null;
}

/** Build the overlay from its stored rows. */
export function overlayFrom(
  names: ReadonlyArray<{ original: string; display: string }> | null | undefined,
  edits: ReadonlyArray<{ line_id: string; text: string }> | null | undefined,
): TranscriptOverlay {
  return {
    names: new Map((names ?? []).filter((n) => n.original && n.display).map((n) => [n.original, n.display])),
    edits: new Map((edits ?? []).filter((e) => e.line_id && e.text).map((e) => [e.line_id, e.text])),
  };
}

/** Apply names and corrections to the stored rows. Rows are copied, never changed in place. */
export function applyOverlay<T extends OverlayRow>(rows: readonly T[], overlay: TranscriptOverlay): Array<T & ShownRow> {
  if (!overlay.names.size && !overlay.edits.size) return rows.map((r) => ({ ...r }));
  return rows.map((r) => {
    const out: T & ShownRow = { ...r };
    const speaker = (r.speaker ?? "").trim();
    const name = speaker ? overlay.names.get(speaker) : undefined;
    if (name && name !== speaker) {
      out.originalSpeaker = speaker;
      out.speaker = name;
    }
    const edit = r.id ? overlay.edits.get(r.id) : undefined;
    if (edit !== undefined && edit !== r.text) {
      out.original = r.text;
      out.text = edit;
    }
    return out;
  });
}

/**
 * Names applied to the stored transcript text, for meetings whose timed rows
 * are missing and the panel falls back to it. Speaker prefixes are matched as
 * whole labels at the start of a line, so "Speaker 1" never touches
 * "Speaker 10".
 */
export function renameInText(text: string, names: ReadonlyMap<string, string>): string {
  if (!names.size || !text) return text;
  return text
    .split("\n")
    .map((line) => {
      const m = /^(\s*)([^:\n]{1,80}?)(\s*(?:\([^)]*\))?\s*:)/.exec(line);
      if (!m) return line;
      const name = names.get(m[2].trim());
      return name ? `${m[1]}${name}${m[3]}${line.slice(m[0].length)}` : line;
    })
    .join("\n");
}

/** The speaker labels a transcript has, as heard, most-spoken first. */
export function speakersHeard(rows: readonly OverlayRow[], text?: string | null): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const s = (r.speaker ?? "").trim();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (!counts.size && text) {
    for (const t of parseTranscript(text)) if (t.speaker) counts.set(t.speaker, (counts.get(t.speaker) ?? 0) + t.paragraphs.length);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
}

// ── Talk time ─────────────────────────────────────────────────────────────

/** Speech runs at about this many words a minute; used where the clock cannot say. */
const WORDS_PER_MINUTE = 150;
/** A pause longer than this between lines is silence, not speech. */
const MAX_GAP_MS = 20_000;

export interface SpeakerStats {
  speaker: string;
  words: number;
  /** Estimated speaking time. */
  ms: number;
  /** Share of all speaking time, 0–1. */
  share: number;
  turns: number;
  /** The longest unbroken stretch, in estimated ms. */
  longestMs: number;
  questions: number;
}

export interface TalkStats {
  speakers: SpeakerStats[];
  totalMs: number;
  totalWords: number;
  /** The speaker with the longest unbroken stretch, when it was long enough to note. */
  monologue: { speaker: string; ms: number } | null;
}

function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** A stretch this long is worth calling out. */
export const MONOLOGUE_MS = 3 * 60_000;

/**
 * Who did the talking. Time comes from the clock where it can — a line lasts
 * until the next one begins, unless the gap is a silence — and from the
 * length of what was said where it cannot (the last line, or a long pause).
 */
export function talkStats(rows: readonly OverlayRow[]): TalkStats {
  const timed = rows
    .map((r) => ({ speaker: (r.speaker ?? "").trim() || "Unattributed", text: r.text ?? "", at: Date.parse(r.ts) }))
    .filter((r) => r.text.trim())
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) ? a.at - b.at : 0));
  const by = new Map<string, SpeakerStats>();
  let prevSpeaker: string | null = null;
  let run = 0;
  const closeRun = (speaker: string | null) => {
    if (!speaker) return;
    const s = by.get(speaker)!;
    s.longestMs = Math.max(s.longestMs, run);
  };
  for (let i = 0; i < timed.length; i++) {
    const r = timed[i];
    const w = words(r.text);
    const byWords = (w / WORDS_PER_MINUTE) * 60_000;
    const next = timed[i + 1];
    const gap = next && Number.isFinite(next.at) && Number.isFinite(r.at) ? next.at - r.at : NaN;
    const ms = Number.isFinite(gap) && gap >= 0 && gap <= MAX_GAP_MS ? Math.max(gap, Math.min(byWords, MAX_GAP_MS)) : byWords;
    const s = by.get(r.speaker) ?? { speaker: r.speaker, words: 0, ms: 0, share: 0, turns: 0, longestMs: 0, questions: 0 };
    by.set(r.speaker, s);
    s.words += w;
    s.ms += ms;
    s.questions += (r.text.match(/\?/g) ?? []).length;
    if (r.speaker !== prevSpeaker) {
      closeRun(prevSpeaker);
      s.turns += 1;
      run = 0;
      prevSpeaker = r.speaker;
    }
    run += ms;
  }
  closeRun(prevSpeaker);
  const speakers = [...by.values()].sort((a, b) => b.ms - a.ms);
  const totalMs = speakers.reduce((n, s) => n + s.ms, 0);
  for (const s of speakers) s.share = totalMs ? s.ms / totalMs : 0;
  const longest = speakers.reduce<SpeakerStats | null>((best, s) => (!best || s.longestMs > best.longestMs ? s : best), null);
  return {
    speakers,
    totalMs,
    totalWords: speakers.reduce((n, s) => n + s.words, 0),
    monologue: longest && longest.longestMs >= MONOLOGUE_MS ? { speaker: longest.speaker, ms: longest.longestMs } : null,
  };
}

/** "4m 10s", "45s", "1h 02m". */
export function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ── Export ────────────────────────────────────────────────────────────────

export const EXPORT_FORMATS = ["txt", "md", "srt", "vtt", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === "string" && (EXPORT_FORMATS as readonly string[]).includes(v);
}

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  txt: "Plain text (.txt)",
  md: "Markdown (.md)",
  srt: "Captions (.srt)",
  vtt: "Captions (.vtt)",
  docx: "Word (.docx)",
};

export const EXPORT_TYPES: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** A line placed on a clock: milliseconds from the start of the meeting (or recording). */
export interface ExportLine {
  speaker: string;
  text: string;
  atMs: number;
}

/** Lines for export, timed from `originMs` (the recording's start, or the first line). */
export function exportLines(rows: readonly OverlayRow[], originMs?: number | null): ExportLine[] {
  const ordered = rows
    .filter((r) => (r.text ?? "").trim())
    .map((r) => ({ speaker: (r.speaker ?? "").trim(), text: r.text.trim(), at: Date.parse(r.ts) }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
  const origin = Number.isFinite(originMs ?? NaN) ? (originMs as number) : ordered[0]?.at ?? 0;
  return ordered.map((r) => ({ speaker: r.speaker, text: r.text, atMs: Math.max(0, r.at - origin) }));
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function captionClock(ms: number, sep: "," | "."): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(milli).padStart(3, "0")}`;
}

/** Consecutive lines by one speaker, as one turn. */
function turns(lines: readonly ExportLine[]): Array<{ speaker: string; atMs: number; texts: string[] }> {
  const out: Array<{ speaker: string; atMs: number; texts: string[] }> = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && last.speaker === l.speaker) last.texts.push(l.text);
    else out.push({ speaker: l.speaker, atMs: l.atMs, texts: [l.text] });
  }
  return out;
}

export function toText(lines: readonly ExportLine[], opts: { title: string; timestamps: boolean }): string {
  const body = turns(lines).map((t) => {
    const who = t.speaker || "Unattributed";
    return `${opts.timestamps ? `[${clock(t.atMs)}] ` : ""}${who}: ${t.texts.join(" ")}`;
  });
  return `${opts.title}\n\n${body.join("\n\n")}\n`;
}

function mdEscape(s: string): string {
  return s.replace(/([\\`*_[\]#<>|])/g, "\\$1");
}

export function toMarkdown(lines: readonly ExportLine[], opts: { title: string; timestamps: boolean }): string {
  const body = turns(lines).map((t) => {
    const who = mdEscape(t.speaker || "Unattributed");
    return `**${who}**${opts.timestamps ? ` · ${clock(t.atMs)}` : ""}\n\n${t.texts.map(mdEscape).join(" ")}`;
  });
  return `# ${mdEscape(opts.title)}\n\n${body.join("\n\n")}\n`;
}

/** How long a caption stays up when the next line does not end it. */
const CAPTION_MAX_MS = 6_000;

function captionCues(lines: readonly ExportLine[]): Array<{ start: number; end: number; text: string }> {
  return lines.map((l, i) => {
    const next = lines[i + 1];
    const byWords = Math.max(1_500, Math.min(CAPTION_MAX_MS, (words(l.text) / WORDS_PER_MINUTE) * 60_000));
    const end = next ? Math.min(next.atMs, l.atMs + CAPTION_MAX_MS) : l.atMs + byWords;
    return { start: l.atMs, end: Math.max(end, l.atMs + 500), text: l.speaker ? `${l.speaker}: ${l.text}` : l.text };
  });
}

export function toSrt(lines: readonly ExportLine[]): string {
  return (
    captionCues(lines)
      .map((c, i) => `${i + 1}\n${captionClock(c.start, ",")} --> ${captionClock(c.end, ",")}\n${c.text.replace(/\n+/g, " ")}`)
      .join("\n\n") + "\n"
  );
}

/**
 * WebVTT cue text is markup: "&", "<" and ">" must be written as character
 * references, or a speaker's words could open a tag (or end the cue with
 * "-->"). Escaping ">" is what keeps "-->" out of a cue.
 */
function vttEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toVtt(lines: readonly ExportLine[]): string {
  const cues = captionCues(lines).map(
    (c) => `${captionClock(c.start, ".")} --> ${captionClock(c.end, ".")}\n${vttEscape(c.text.replace(/\n+/g, " "))}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** A file name from the meeting's date, never its title (a title is user input in a header). */
export function exportFileName(at: Date, format: ExportFormat): string {
  const day = isNaN(at.getTime()) ? "meeting" : at.toISOString().slice(0, 10);
  return `meeting-transcript-${day}.${format}`;
}

// ── Quotes ────────────────────────────────────────────────────────────────

/** A quote to paste elsewhere: the words, who said them, when, and a link to that moment. */
export function quoteFor(opts: { speaker: string; text: string; atMs: number | null; url: string | null }): string {
  const who = opts.speaker || "Unattributed";
  const when = opts.atMs !== null ? ` (${clock(opts.atMs)})` : "";
  const link = opts.url ? `\n${opts.url}` : "";
  return `“${opts.text.trim()}” — ${who}${when}${link}`;
}

/** The report's address with a moment: `?t=` in whole seconds, which the report follows on arrival. */
export function momentUrl(base: string, atMs: number): string {
  try {
    const u = new URL(base);
    u.searchParams.set("t", String(Math.floor(atMs / 1000)));
    u.hash = "";
    return u.toString();
  } catch {
    return base;
  }
}
