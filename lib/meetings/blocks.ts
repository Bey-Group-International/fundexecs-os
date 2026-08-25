// lib/meetings/blocks.ts
// Manually blocked time — the rules, with no I/O.
//
// A block is a half-open interval [starts_at, ends_at) belonging to one member.
// Half-open is what makes back-to-back blocks behave: a block ending at 14:00
// and a meeting starting at 14:00 do not collide, matching how the database's
// booking overlap constraint already treats ranges.

/** Longest single block. A whole day is reasonable; a whole year is a mistake. */
export const MAX_BLOCK_MINUTES = 24 * 60;
/** Shortest single block — below this it blocks nothing anyone could have booked. */
export const MIN_BLOCK_MINUTES = 5;
export const DEFAULT_BLOCK_TITLE = "Busy";
const MAX_TITLE_LENGTH = 120;

export interface SchedulingBlockRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  created_at?: string;
  updated_at?: string;
}

/** A block as the calendar and API speak about it. */
export interface SerializedBlock {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export function serializeBlock(row: SchedulingBlockRow): SerializedBlock {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export interface BlockInput {
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export type BlockValidation =
  | { ok: true; title: string; startsAt: string; endsAt: string }
  | { ok: false; error: string };

/**
 * Validate and normalize a block a client asked for. Returns the reason rather
 * than throwing, so a route can answer 422 with something a person can act on.
 */
export function validateBlock(input: BlockInput): BlockValidation {
  const start = new Date(input.startsAt ?? "");
  const end = new Date(input.endsAt ?? "");
  if (isNaN(start.getTime())) return { ok: false, error: "Give the block a valid start time." };
  if (isNaN(end.getTime())) return { ok: false, error: "Give the block a valid end time." };

  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes <= 0) return { ok: false, error: "A block has to end after it starts." };
  if (minutes < MIN_BLOCK_MINUTES) {
    return { ok: false, error: `A block needs to be at least ${MIN_BLOCK_MINUTES} minutes.` };
  }
  if (minutes > MAX_BLOCK_MINUTES) {
    return { ok: false, error: "A single block can't run longer than 24 hours. Add one per day." };
  }

  const title = (input.title ?? "").trim().slice(0, MAX_TITLE_LENGTH) || DEFAULT_BLOCK_TITLE;
  return { ok: true, title, startsAt: start.toISOString(), endsAt: end.toISOString() };
}

export interface BlockInterval {
  start: string;
  end: string;
}

/**
 * Blocks as busy intervals, for the availability calculation that decides which
 * slots the public booking link offers. The title is deliberately dropped: an
 * invitee learns the time is unavailable, never why.
 */
export function blocksToBusyIntervals(blocks: Array<Pick<SchedulingBlockRow, "starts_at" | "ends_at">>): BlockInterval[] {
  const out: BlockInterval[] = [];
  for (const b of blocks) {
    const start = new Date(b.starts_at);
    const end = new Date(b.ends_at);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    if (end.getTime() <= start.getTime()) continue;
    out.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return out;
}

export interface BlockConflict {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Which of a member's blocks overlap a proposed meeting. Half-open on both
 * sides, so a meeting butting up against a block is not a conflict.
 *
 * Kept separate from findConflicts() rather than folded into it: that function
 * scopes a meeting-vs-meeting overlap to a shared person, which has no meaning
 * here — a block already belongs to exactly one person, and the caller has
 * already decided whose blocks to pass in.
 */
export function findBlockConflicts(
  blocks: Array<Pick<SchedulingBlockRow, "id" | "title" | "starts_at" | "ends_at">>,
  startIso: string,
  endIso: string,
): BlockConflict[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const out: BlockConflict[] = [];
  for (const b of blocks) {
    const bStart = new Date(b.starts_at).getTime();
    const bEnd = new Date(b.ends_at).getTime();
    if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) continue;
    if (bStart < end && bEnd > start) {
      out.push({ id: b.id, title: b.title, startsAt: b.starts_at, endsAt: b.ends_at });
    }
  }
  return out;
}

/**
 * A block's default end for a slot the host clicked. One hour, clamped so a
 * click late in the evening cannot spill past midnight into the next day —
 * which would otherwise block a morning the host never meant to touch.
 */
export function defaultBlockEnd(startIso: string, minutes = 60): string {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return startIso;
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 0, 0);
  const naive = new Date(start.getTime() + minutes * 60_000);
  return (naive > endOfDay ? endOfDay : naive).toISOString();
}
