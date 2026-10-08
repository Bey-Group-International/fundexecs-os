// lib/meetings/report-insights.ts
// The parts of a report that help somebody act on a meeting rather than recall
// it: the moments that mattered, what was left open, what could go wrong, what
// each person took away, and what the next meeting should cover.
//
// All of it comes out of the one report call the meeting already makes when it
// ends — nothing here costs a model call during the meeting, which stays
// silent. This file is the boundary those fields cross: a model asked for a list
// of {point, quote} objects does not always answer in that shape, and a report
// written before these fields existed has none of them, so every reader goes
// through here and gets a well-formed value or an empty one.
//
// Pure: no React, no Supabase.

import { normalizeNoteItem, normalizeNoteList } from "@/lib/meetings/live-notes";

/** The analysis keys these fields are stored under. */
export const HIGHLIGHTS_KEY = "highlights";
export const UNRESOLVED_KEY = "unresolved";
export const RISKS_KEY = "risks";
export const AGENDA_KEY = "next_meeting_agenda";

/** At most this many highlights are kept: a list of everything is a list of nothing. */
export const MAX_HIGHLIGHTS = 8;

/** A moment worth going back to. */
export interface Highlight {
  /** What happened, in a line. */
  point: string;
  /**
   * The words that were said, verbatim from the transcript — what places the
   * highlight on the recording. Empty when the model gave none.
   */
  quote: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** Strip the quotation marks a model likes to wrap a quote in. */
function unquote(s: string): string {
  return s.replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
}

/**
 * The highlights, however the model shaped them.
 *
 * `{ point, quote }` is what is asked for. A bare string is a point with no
 * quote; an object with only a quote uses the quote as its point. Duplicates
 * and empties are dropped, and the list is capped.
 */
export function normalizeHighlights(raw: unknown): Highlight[] {
  if (!Array.isArray(raw)) return [];
  const out: Highlight[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let point = "";
    let quote = "";
    if (typeof item === "string") point = str(item);
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      point = str(o.point) || str(o.title) || str(o.summary) || str(o.moment) || str(o.text);
      quote = unquote(str(o.quote) || str(o.said) || str(o.words));
      if (!point && quote) point = quote;
      if (!point) point = normalizeNoteItem(item);
    }
    if (!point) continue;
    const key = point.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ point, quote });
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

/** Text reduced to its words alone, padded so containment respects word edges. */
function flatWords(text: string): string {
  return ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Whether a quote really appears in the record, word for word.
 *
 * Case, punctuation and spacing are set aside — a verbatim copy survives all
 * three drifting — but the words and their order must match exactly. Anything
 * looser would re-admit the thing this exists to stop.
 */
export function quoteInRecord(quote: string, record: string): boolean {
  const q = flatWords(quote).trim();
  if (!q) return false;
  return flatWords(record).includes(` ${q} `);
}

/**
 * Highlights with every quote checked against the transcript.
 *
 * A highlight's quote is rendered in quotation marks and used to find the
 * moment on the recording — the report presents it as words somebody actually
 * said. The model is asked to copy it exactly, and mostly does; when it
 * paraphrases instead, the page was putting invented speech in a participant's
 * mouth, in a document that gets exported and emailed. A quote the record does
 * not contain is dropped — the point stays, only the claim of exact words
 * goes. A quote that spans two transcript lines fails the check and is dropped
 * too: losing a true italic line is the cheap side of this trade.
 *
 * No record at all proves nothing — a meeting stored before transcripts were
 * kept must not lose its quotes to a check that had nothing to check against.
 */
export function verifyHighlightQuotes(
  highlights: Highlight[],
  record: string | null | undefined,
): Highlight[] {
  const text = (record ?? "").trim();
  if (!text) return highlights;
  const flat = flatWords(text);
  return highlights.map((h) => {
    if (!h.quote) return h;
    const q = flatWords(h.quote).trim();
    return q && flat.includes(` ${q} `) ? h : { ...h, quote: "" };
  });
}

/** A line of the form "Owner: text", split; no owner when the line has none. */
export interface OwnedLine {
  owner: string | null;
  text: string;
}

/**
 * Split "Jane: Will the LPAC accept 15%?" into who and what.
 *
 * Only a short, name-like prefix counts as an owner — "Risk: the side letter…"
 * or a sentence that happens to contain a colon is left whole. The same rule
 * the action items are written to ("Owner: task").
 */
export function splitOwner(line: string): OwnedLine {
  const m = /^\s*([^:]{1,40}):\s+(.+)$/.exec(line);
  if (!m) return { owner: null, text: line.trim() };
  const owner = m[1].trim();
  // A name is a few capitalised words ("Jane", "Jane Doe", "Ana de la Cruz"),
  // not the start of a sentence that happens to have a colon in it.
  const words = owner.split(/\s+/);
  const PARTICLES = new Set(["de", "da", "del", "la", "le", "van", "von", "der", "den", "di", "du", "bin", "al"]);
  const nameLike =
    words.length <= 4 &&
    /^[A-Z]/.test(words[0]) &&
    words.every((w) => /^[A-Z][\w'’.-]*$/.test(w) || PARTICLES.has(w));
  return nameLike ? { owner, text: m[2].trim() } : { owner: null, text: line.trim() };
}

/** Everything a report says to act on, read once. */
export interface ReportInsights {
  highlights: Highlight[];
  /** Raised in the meeting and not answered, with who should answer. */
  unresolved: OwnedLine[];
  risks: string[];
  /** A draft agenda for the next meeting, one item per line. */
  agenda: string[];
}

export function reportInsights(
  analysis: Record<string, unknown> | null | undefined,
  /** The meeting's own transcript, when the caller has it: quotes are verified against it. */
  record?: string | null,
): ReportInsights {
  return {
    highlights: verifyHighlightQuotes(normalizeHighlights(analysis?.[HIGHLIGHTS_KEY]), record),
    unresolved: normalizeNoteList(analysis?.[UNRESOLVED_KEY]).map(splitOwner),
    risks: normalizeNoteList(analysis?.[RISKS_KEY]),
    agenda: normalizeNoteList(analysis?.[AGENDA_KEY]),
  };
}

/** What one person took away from the meeting. */
export interface Commitments<T> {
  /** Their name, or null for the items nobody was given. */
  owner: string | null;
  /** The items, each with its index in the report's own list. */
  items: Array<{ index: number; item: T }>;
}

/**
 * The action items grouped by who owns them, in the order people first appear,
 * with the unowned ones last — the list a host sends each person, or reads down
 * to see who is carrying the most.
 *
 * Names are compared without case or surrounding space, so "priya" and "Priya"
 * are one person; the first spelling seen is the one shown.
 */
export function commitmentsByPerson<T extends { owner: string | null }>(items: readonly T[]): Commitments<T>[] {
  const groups = new Map<string, Commitments<T>>();
  let unowned: Commitments<T> | null = null;
  items.forEach((item, index) => {
    const name = (item.owner ?? "").trim();
    if (!name) {
      unowned ??= { owner: null, items: [] };
      unowned.items.push({ index, item });
      return;
    }
    const key = name.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { owner: name, items: [] };
      groups.set(key, group);
    }
    group.items.push({ index, item });
  });
  const out = [...groups.values()];
  if (unowned) out.push(unowned);
  return out;
}
