// lib/meetings/lobby.ts
// The meetings lobby's two judgements: what a pasted "code" actually is, and
// which meeting the up-next strip should put in front of somebody.
//
// Pure: no DOM, no React. "Now" and the time zone are always passed in.

/** Route segments that live under /meetings and are not rooms. */
const NOT_ROOMS = new Set(["calls", "record", "device-check", "report"]);

/**
 * The room code in whatever was typed or pasted into "Enter a meeting code".
 *
 * People paste links far more often than they type codes — the invite email,
 * the calendar event and the share button all hand out a URL — and the field
 * used to lower-case the whole link and navigate to `/meetings/https://…`, a
 * room that cannot exist. So a link is read for the code it carries: after
 * `/meetings/` or `/meeting-invite/`, or a `room` or `code` query parameter.
 * A bare code has its spaces dropped and is lower-cased, as before.
 *
 * Null when there is nothing that could be a room: an empty field, a link with
 * no room in it, or something with characters no room code has.
 */
export function roomCodeFromInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const looksLikeLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[^\s/]+\.[a-z]{2,}\//i.test(raw) || raw.startsWith("/");
  if (looksLikeLink) {
    let url: URL;
    try {
      url = new URL(raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`, "https://x.invalid");
    } catch {
      return null;
    }
    const fromQuery = url.searchParams.get("room") ?? url.searchParams.get("code");
    if (fromQuery) return clean(fromQuery);
    const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
    const at = parts.findIndex((p) => p === "meetings" || p === "meeting-invite");
    const candidate = at >= 0 ? parts[at + 1] : null;
    if (!candidate || NOT_ROOMS.has(candidate.toLowerCase())) return null;
    return clean(candidate);
  }
  return clean(raw);
}

function clean(code: string): string | null {
  const c = code.toLowerCase().replace(/\s+/g, "");
  // Room codes are letters, digits and dashes. Anything else is not one, and
  // navigating to it would only show "meeting not found".
  return /^[a-z0-9-]{3,64}$/.test(c) ? c : null;
}

/** The fields of a meeting the up-next rule reads. */
export interface LobbyMeeting {
  id: string;
  title: string;
  room_code: string;
  status: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  is_draft?: boolean | null;
}

export interface UpNext<T extends LobbyMeeting> {
  meeting: T;
  /** Someone is in the room, or the clock says it is under way. */
  live: boolean;
  /** Who is in the room, when anyone is. */
  inRoom: { count: number; names: string[] };
}

/**
 * The meeting the lobby should offer to join: a live one first — a room with
 * people in it, then one the clock says is under way — and otherwise the next
 * one still to start today. Nothing when the rest of the day is clear: a strip
 * that says "nothing today" is a strip nobody needed to read.
 *
 * "Today" is the reader's calendar day in their own zone.
 */
export function upNextMeeting<T extends LobbyMeeting>(
  meetings: readonly T[],
  presence: Record<string, { count: number; names: string[] } | undefined>,
  now: number,
  timeZone?: string,
): UpNext<T> | null {
  const day = (t: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const today = day(now);
  const candidates = meetings.filter((m) => m.status !== "ended" && !m.is_draft);

  const span = (m: T) => {
    if (!m.scheduled_at) return null;
    const start = Date.parse(m.scheduled_at);
    if (Number.isNaN(start)) return null;
    return [start, start + (m.duration_minutes && m.duration_minutes > 0 ? m.duration_minutes : 60) * 60_000] as const;
  };
  const roomOf = (m: T) => presence[m.id] ?? { count: 0, names: [] };

  // People in the room outrank the clock: a meeting that ran over is still the
  // one to join, and an early start is live before its time.
  const occupied = candidates
    .filter((m) => roomOf(m).count > 0)
    .sort((a, b) => roomOf(b).count - roomOf(a).count);
  if (occupied[0]) return { meeting: occupied[0], live: true, inRoom: roomOf(occupied[0]) };

  const running = candidates
    .map((m) => ({ m, s: span(m) }))
    .filter((x) => x.s && now >= x.s[0] && now < x.s[1])
    .sort((a, b) => a.s![0] - b.s![0]);
  if (running[0]) return { meeting: running[0].m, live: true, inRoom: roomOf(running[0].m) };

  const later = candidates
    .map((m) => ({ m, s: span(m) }))
    .filter((x) => x.s && x.s[0] > now && day(x.s[0]) === today)
    .sort((a, b) => a.s![0] - b.s![0]);
  if (later[0]) return { meeting: later[0].m, live: false, inRoom: roomOf(later[0].m) };
  return null;
}
