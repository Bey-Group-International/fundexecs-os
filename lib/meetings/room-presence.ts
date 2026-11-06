// lib/meetings/room-presence.ts
// Who is already in a room, as the screen before it shows it: how many, since
// when, whether the host has arrived — and, for a member of the firm, names.
//
// Pure: no React, no Supabase.

import { isPresent, type ParticipantRow } from "@/lib/meetings/attendance";

export interface RoomSnapshot {
  count: number;
  /** Whether the host is among them. */
  hostPresent: boolean;
  /** When the earliest person still in the room joined; null when nobody is. */
  startedAt: string | null;
  /** Display names, only for a caller allowed to see them; empty otherwise. */
  names: string[];
}

export const EMPTY_ROOM: RoomSnapshot = { count: 0, hostPresent: false, startedAt: null, names: [] };

/** The room's present people, one per identity, from raw participant rows. */
export function roomSnapshot(
  rows: readonly ParticipantRow[],
  hostId: string | null,
  opts: { now?: number; withNames?: boolean; maxNames?: number } = {},
): RoomSnapshot {
  const now = opts.now ?? Date.now();
  const seen = new Set<string>();
  let count = 0;
  let hostPresent = false;
  let earliest: number | null = null;
  const names: string[] = [];
  rows.forEach((row, i) => {
    if (!isPresent(row, now)) return;
    const id = row.user_id ? `u:${row.user_id}` : row.guest_key ? `g:${row.guest_key}` : `r:${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    count += 1;
    if (hostId && row.user_id === hostId) hostPresent = true;
    const joined = row.joined_at ? new Date(row.joined_at).getTime() : NaN;
    if (Number.isFinite(joined) && (earliest === null || joined < earliest)) earliest = joined;
    if (opts.withNames && names.length < (opts.maxNames ?? 6) && row.display_name?.trim()) names.push(row.display_name.trim());
  });
  return { count, hostPresent, startedAt: earliest === null ? null : new Date(earliest).toISOString(), names };
}

function ago(fromIso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

/**
 * The line the pre-join screen shows: "Ana, Bo and 1 other are in · started
 * 12 min ago", "3 people are in", or "No one is here yet".
 */
export function inRoomLine(s: RoomSnapshot, now: number): string {
  if (s.count === 0) return "No one is here yet";
  let who: string;
  if (s.names.length) {
    const shown = s.names.slice(0, 2);
    const others = s.count - shown.length;
    who =
      others > 0
        ? `${shown.join(", ")} and ${others} other${others === 1 ? "" : "s"}`
        : shown.length === 2
          ? `${shown[0]} and ${shown[1]}`
          : shown[0];
    who += s.count === 1 ? " is in" : " are in";
  } else {
    who = s.count === 1 ? "1 person is in" : `${s.count} people are in`;
  }
  return s.startedAt ? `${who} · started ${ago(s.startedAt, now)}` : who;
}

/**
 * What a waiting guest is told about the host, added to the wait's own words.
 * Null while nothing is known, so the wait reads as it always did.
 */
export function hostWaitNote(s: RoomSnapshot | null): string | null {
  if (!s) return null;
  if (!s.hostPresent) return "The host hasn't joined yet — you'll be let in once they arrive.";
  return "The host is in the meeting and has been told you're here.";
}
