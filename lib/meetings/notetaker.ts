// lib/meetings/notetaker.ts
// The meeting notetaker's rules: the host's settings, the firm's glossary,
// bookmarks, and the transcript as text to copy or keep.
//
// Pure: no React, no Supabase. The room, the routes and the report all read
// the same definitions from here.

/** Who may read the live AI notes during the call. */
export type NotesVisibility = "everyone" | "host";

export interface NotetakerSettings {
  /** Nothing is transcribed or noted while paused. */
  paused: boolean;
  notesVisibility: NotesVisibility;
  /** A BCP 47 tag for the recogniser, or null for each person's browser language. */
  lang: string | null;
}

export const DEFAULT_NOTETAKER: NotetakerSettings = { paused: false, notesVisibility: "everyone", lang: null };

/** The languages offered in the picker; any valid tag is accepted from the API. */
export const NOTETAKER_LANGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: "en-US", label: "English (US)" },
  { tag: "en-GB", label: "English (UK)" },
  { tag: "es-ES", label: "Spanish" },
  { tag: "fr-FR", label: "French" },
  { tag: "de-DE", label: "German" },
  { tag: "pt-BR", label: "Portuguese (Brazil)" },
  { tag: "it-IT", label: "Italian" },
  { tag: "nl-NL", label: "Dutch" },
  { tag: "ja-JP", label: "Japanese" },
  { tag: "zh-CN", label: "Chinese (Mandarin)" },
  { tag: "ar-SA", label: "Arabic" },
  { tag: "hi-IN", label: "Hindi" },
];

const LANG_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

function cleanLang(raw: unknown): string | null | undefined {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return LANG_TAG.test(t) && t.length <= 35 ? t : undefined;
}

/** Whatever is stored, read as settings; anything unreadable falls back to the default. */
export function readNotetaker(raw: unknown): NotetakerSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lang = cleanLang(o.lang);
  return {
    paused: o.paused === true,
    notesVisibility: o.notesVisibility === "host" ? "host" : "everyone",
    lang: lang === undefined ? null : lang,
  };
}

/**
 * A host's change applied to the current settings. Null when the change says
 * nothing valid — an unknown field or a malformed language is refused rather
 * than half applied.
 */
export function patchNotetaker(current: NotetakerSettings, patch: unknown): NotetakerSettings | null {
  if (!patch || typeof patch !== "object") return null;
  const p = patch as Record<string, unknown>;
  const next = { ...current };
  let changed = false;
  if ("paused" in p) {
    if (typeof p.paused !== "boolean") return null;
    next.paused = p.paused;
    changed = true;
  }
  if ("notesVisibility" in p) {
    if (p.notesVisibility !== "everyone" && p.notesVisibility !== "host") return null;
    next.notesVisibility = p.notesVisibility;
    changed = true;
  }
  if ("lang" in p) {
    const lang = cleanLang(p.lang);
    if (lang === undefined) return null;
    next.lang = lang;
    changed = true;
  }
  return changed ? next : null;
}

/** Whether this viewer may read the live notes. */
export function canSeeLiveNotes(settings: NotetakerSettings, isHost: boolean): boolean {
  return isHost || settings.notesVisibility === "everyone";
}

/** The line every participant sees while the notetaker is on. */
export function consentNotice(settings: NotetakerSettings): string {
  if (settings.paused) return "The notetaker is paused. Nothing said now is transcribed or noted.";
  return "The notetaker is on: what's said in this meeting is transcribed and noted. The host can pause it at any time.";
}

// ─── Glossary ───────────────────────────────────────────────────────────────

export const GLOSSARY_MAX_TERMS = 200;
export const GLOSSARY_TERM_MAX = 80;

/** A term as stored: one line, trimmed, 2–80 characters; null otherwise. */
export function cleanTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= GLOSSARY_TERM_MAX ? t : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How a term is likely to be heard. Words may come back split or hyphenated
 * ("Dunbar Capital", "dunbar-capital"); an acronym is often spelled out a
 * letter at a time ("l p a c", "L.P.A.C.").
 */
function termPattern(term: string): RegExp | null {
  const words = term.split(" ").filter(Boolean);
  if (!words.length) return null;
  let body: string;
  if (words.length === 1 && /^[A-Z0-9]{2,6}$/.test(term)) {
    body = term.split("").map(escapeRe).join("[\\s.]*") + "\\.?";
  } else {
    body = words.map(escapeRe).join("[\\s-]+");
  }
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}])(${body})(?=$|[^\\p{L}\\p{N}])`, "giu");
  } catch {
    return null;
  }
}

/**
 * The text with each glossary term restored to the firm's spelling. Longest
 * terms first, so "Dunbar Capital Partners" wins over "Dunbar".
 */
export function applyGlossary(text: string, terms: readonly string[]): string {
  if (!text || !terms.length) return text;
  let out = text;
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const re = termPattern(term);
    if (!re) continue;
    out = out.replace(re, (_m, lead: string) => `${lead}${term}`);
  }
  return out;
}

/** The glossary as the report model is told it. */
export function glossaryForModel(terms: readonly string[]): string {
  const list = terms.map(cleanTerm).filter((t): t is string => Boolean(t)).slice(0, GLOSSARY_MAX_TERMS);
  return list.length ? `Names and terms this firm uses (spell them exactly so): ${list.join("; ")}` : "";
}

// ─── Bookmarks and notes ────────────────────────────────────────────────────

export const BOOKMARK_LABEL_MAX = 200;
export const NOTES_MAX = 20_000;

export interface Bookmark {
  id: string;
  /** When it was flagged, ISO. */
  at: string;
  label: string | null;
  /** Who flagged it, when known. */
  by?: string | null;
}

export function cleanBookmarkLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, BOOKMARK_LABEL_MAX).trim();
  return t || null;
}

export function cleanNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.replace(/\r\n/g, "\n").replace(/\u0000/g, "").slice(0, NOTES_MAX);
}

/** "12:04" or "1:02:03" into the meeting, from its start. */
export function offsetClock(atMs: number, startMs: number): string {
  const total = Math.max(0, Math.floor((atMs - startMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Bookmarks as the report model reads them: in order, at their place in the
 * meeting, with who flagged them. Empty when there are none.
 */
export function bookmarksForModel(bookmarks: readonly Bookmark[], startedAt: string | null): string {
  if (!bookmarks.length) return "";
  const start = startedAt ? Date.parse(startedAt) : Date.parse(bookmarks[0].at);
  const lines = [...bookmarks]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 50)
    .map((b) => `- ${offsetClock(Date.parse(b.at), start)}${b.by ? ` (${b.by})` : ""}: ${b.label ?? "flagged as important"}`);
  return `Moments people flagged during the meeting (treat these as important):\n${lines.join("\n")}`;
}

/** The host's own notes, for the report model; empty when there are none. */
export function hostNotesForModel(notes: string | null | undefined): string {
  const t = (notes ?? "").trim();
  if (!t) return "";
  return `The host's own notes from the meeting (they were there; prefer these where they disagree with the transcript):\n${t.slice(0, 6000)}`;
}

// ─── The transcript as text ─────────────────────────────────────────────────

export interface TextLine {
  speaker: string;
  text: string;
  ts: number;
  final?: boolean;
}

/** "[10:02] Ana Ruiz: Morning everyone", one per line, finals only. */
export function transcriptAsText(lines: readonly TextLine[], clock: (ts: number) => string): string {
  return lines
    .filter((l) => l.final !== false && l.text.trim())
    .map((l) => `[${clock(l.ts)}] ${l.speaker}: ${l.text.trim()}`)
    .join("\n");
}

/** A file name for the downloaded transcript. */
export function transcriptFileName(title: string, at: Date): string {
  const slug = (title || "meeting")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "meeting";
  return `${slug}-transcript-${at.toISOString().slice(0, 10)}.txt`;
}

export interface MergeableLine {
  id: string;
  speakerId: string;
  text: string;
  ts: number;
  final: boolean;
}

/** Consecutive lines from one speaker this close together are one turn. */
export const MERGE_GAP_MS = 8_000;

/**
 * Fragments joined into turns: one speaker's consecutive final lines, each
 * starting within MERGE_GAP_MS of the last, read as one paragraph. The
 * recogniser cuts a sentence wherever it pauses; a reader should not have to.
 * Interim lines are never merged — they are still changing.
 */
export function mergeFragments<T extends MergeableLine>(lines: readonly T[]): Array<T & { parts: number }> {
  const out: Array<T & { parts: number; lastTs: number }> = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.final && line.final && prev.speakerId === line.speakerId && line.ts - prev.lastTs <= MERGE_GAP_MS) {
      prev.text = `${prev.text.trimEnd()} ${line.text.trim()}`;
      prev.parts += 1;
      prev.lastTs = line.ts;
      continue;
    }
    out.push({ ...line, parts: 1, lastTs: line.ts });
  }
  return out.map(({ lastTs: _lastTs, ...rest }) => rest as T & { parts: number });
}

// ─── When to refresh the live notes ─────────────────────────────────────────

/** New final lines needed before the notes are worth rewriting. */
export const LIVE_NOTES_MIN_NEW_LINES = 6;
/** The least time between two rewrites, whoever asks. */
export const LIVE_NOTES_MIN_INTERVAL_MS = 60_000;

/**
 * Whether the live notes should be rewritten now: enough new talk since the
 * last version, and not too soon after it. Asked by the room on a timer and by
 * the route before it calls the model, so a busy room makes one call a minute,
 * not one per person.
 */
export function liveNotesDue(
  state: { lines: number; lastLines: number; lastAt: number | null },
  now: number,
  force = false,
): boolean {
  if (state.lines <= 0) return false;
  if (state.lastAt !== null && now - state.lastAt < (force ? 15_000 : LIVE_NOTES_MIN_INTERVAL_MS)) return false;
  if (force) return state.lines > state.lastLines;
  return state.lines - state.lastLines >= LIVE_NOTES_MIN_NEW_LINES;
}
