// lib/meetings/calendar-search.ts
// Finding a meeting on the calendar by what you remember about it: a word of
// its title, a person who was on it, or the company they are from ("acme"
// finds everyone at acme.com).
//
// Matching runs in memory over a lightweight list of the organisation's
// meetings, because a guest list is JSON and a database text search cannot
// reach inside it; the list is small enough for that to be instant.
//
// Pure: no React, no Supabase.

export interface SearchableMeeting {
  id: string;
  title: string | null;
  scheduled_at: string | null;
  duration_minutes?: number | null;
  meeting_type?: string | null;
  attendees?: unknown;
  agenda?: string | null;
  objective?: string | null;
}

export interface SearchHit<T extends SearchableMeeting> {
  meeting: T;
  /** What matched, for the result line: "Ana Ruiz", "acme.com", or null for the title. */
  matched: string | null;
  upcoming: boolean;
}

/** Most results shown: enough to scan, few enough to be a list. */
export const SEARCH_LIMIT = 30;

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function people(raw: unknown): Array<{ name: string; email: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; email: string }> = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    const email = typeof o.email === "string" ? o.email : "";
    if (name || email) out.push({ name, email });
  }
  return out;
}

/** Common mail hosts are nobody's company. */
const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "live.com"]);

/**
 * How well a meeting matches every word of the query: 3 for a title word, 2 for
 * a person, 1 for the company in an address or the agenda. Zero when any word
 * matches nothing — every word has to land somewhere.
 */
function score(m: SearchableMeeting, words: string[]): { score: number; matched: string | null } {
  const title = fold(m.title ?? "");
  const extra = fold(`${m.agenda ?? ""} ${m.objective ?? ""}`);
  const who = people(m.attendees);
  let total = 0;
  let matched: string | null = null;
  for (const w of words) {
    if (title.includes(w)) {
      total += 3;
      continue;
    }
    const person = who.find((p) => fold(p.name).includes(w) || fold(p.email.split("@")[0] ?? "").includes(w));
    if (person) {
      total += 2;
      matched ??= person.name || person.email;
      continue;
    }
    const company = who
      .map((p) => fold(p.email.split("@")[1] ?? ""))
      .find((d) => d && !PERSONAL_DOMAINS.has(d) && d.includes(w));
    if (company) {
      total += 1;
      matched ??= company;
      continue;
    }
    if (extra.includes(w)) {
      total += 1;
      continue;
    }
    return { score: 0, matched: null };
  }
  return { score: total, matched };
}

/**
 * Meetings matching the query, best first: upcoming ones soonest first, then
 * past ones most recent first, each group ordered by how well it matched.
 * Empty for a query under two characters.
 */
export function searchMeetings<T extends SearchableMeeting>(
  meetings: readonly T[],
  query: string,
  now: number,
  limit = SEARCH_LIMIT,
): SearchHit<T>[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.join("").length < 2) return [];
  const hits: Array<SearchHit<T> & { score: number; at: number }> = [];
  for (const meeting of meetings) {
    const { score: s, matched } = score(meeting, words);
    if (!s) continue;
    const at = meeting.scheduled_at ? new Date(meeting.scheduled_at).getTime() : 0;
    const end = at + (meeting.duration_minutes ?? 60) * 60_000;
    hits.push({ meeting, matched, upcoming: end >= now, score: s, at });
  }
  hits.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.upcoming ? a.at - b.at : b.at - a.at;
  });
  return hits.slice(0, limit).map(({ meeting, matched, upcoming }) => ({ meeting, matched, upcoming }));
}
