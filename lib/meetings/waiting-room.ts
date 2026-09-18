// lib/meetings/waiting-room.ts
// Keeping the host's "waiting to join" list in step with the database.
//
// The list is driven by Realtime, and the first version answered every event by
// re-reading the whole list. That is one SELECT per knock and one per decision —
// so a class arriving together, or a host pressing "Admit all" on eight people,
// spent eight round trips to redraw a list the events had already described. The
// redraw also could not happen until the read came back, which is the wrong order
// for the one UI in the room where somebody is waiting on the answer.
//
// The events carry the row. Applying them directly is both the cheap path and the
// immediate one; a coalesced re-read still follows to correct any drift (a missed
// event while the socket was down, an ordering surprise), but once per burst
// instead of once per event.

export interface WaitingRow {
  id: string;
  guest_key: string;
  display_name: string;
  status: string;
  /** When this guest last polled for their decision. See PRESENCE_GRACE_MS. */
  last_seen_at?: string | null;
  /** When they knocked, which is the only evidence a first poll has not landed. */
  created_at?: string | null;
}

export interface WaitingEntry {
  id: string;
  from: string;
  displayName: string;
  /** Epoch ms of the last sign of life, or 0 when there has been none. */
  seenAtMs: number;
}

export type AdmissionChange =
  | { eventType: "INSERT" | "UPDATE"; new: WaitingRow }
  | { eventType: "DELETE"; old: { id?: string } };

export function toEntry(row: WaitingRow): WaitingEntry {
  return {
    id: row.id,
    from: row.guest_key,
    displayName: row.display_name,
    seenAtMs: parseTime(row.last_seen_at) || parseTime(row.created_at),
  };
}

/** A timestamp as epoch ms, or 0 for one that is absent or unreadable. */
function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const at = Date.parse(value);
  return Number.isNaN(at) ? 0 : at;
}

/**
 * The list after one Realtime event.
 *
 * Only `waiting` rows belong on it: a decided row is a person who is no longer
 * outside, whichever way the decision went. An INSERT of a row that is already
 * decided (a teammate auto-admitted by the knock route) must therefore not appear
 * at all — the host never has to dismiss their own team from the panel.
 *
 * Newly-waiting rows go on the end, matching the created_at-ascending order the
 * full read uses, so the person who knocked first stays at the top where the host
 * will reach them first. An UPDATE to a row already listed is applied in place
 * rather than moved, for the same reason: a guest correcting their name should
 * not jump the queue.
 */
export function applyAdmissionChange(
  peers: readonly WaitingEntry[],
  change: AdmissionChange,
): WaitingEntry[] {
  if (change.eventType === "DELETE") {
    const id = change.old?.id;
    if (!id) return [...peers];
    return peers.filter((p) => p.id !== id);
  }

  const row = change.new;
  if (!row?.id) return [...peers];

  if (row.status !== "waiting") return peers.filter((p) => p.id !== row.id);

  const entry = toEntry(row);
  const at = peers.findIndex((p) => p.id === row.id);
  if (at === -1) return [...peers, entry];
  const next = [...peers];
  next[at] = entry;
  return next;
}

// ── Who is still actually out there ─────────────────────────────────────────
//
// A `waiting` row is cleared only by a decision, so a guest who knocks and then
// closes the tab stayed in the host's panel for the rest of the meeting. That
// is not merely untidy: it chimes, it badges the browser tab, it counts in
// "Waiting to join (3)", and it ends with the host admitting somebody who is
// not there and waiting for them to appear.
//
// There was never a heartbeat to say otherwise — except there was, and it was
// being thrown away. A waiting guest polls the knock endpoint every second and
// a half for as long as they wait, and that handler only ever SELECTed. The
// hottest read in the meeting stack is the liveness signal this needed, and it
// costs one column to keep.

/**
 * How long a knock survives without a poll.
 *
 * Generously above the poll cadence, which widens from 1.5s but stays well
 * inside this. The margin is for the guest whose phone slept for a moment or
 * whose train went into a tunnel — a host being shown somebody who IS there is
 * a much smaller error than a host told somebody has gone when they have not.
 */
export const PRESENCE_GRACE_MS = 45_000;

/**
 * Whether this entry is somebody still waiting, as of `nowMs`.
 *
 * An entry with no sign of life at all counts as present: it has just been
 * inserted by a Realtime event that carries no `last_seen_at` yet, and
 * `created_at` stands in until the first poll lands. Treating "no evidence" as
 * "gone" would flicker every new knock out of the panel the moment it arrived.
 */
export function stillWaiting(entry: WaitingEntry, nowMs: number, graceMs = PRESENCE_GRACE_MS): boolean {
  if (!entry.seenAtMs) return true;
  return nowMs - entry.seenAtMs <= graceMs;
}

/**
 * The list with the people who have gone taken out.
 *
 * Applied at render rather than by deleting rows: a guest who comes back —
 * reopened the tab, came out of the tunnel — starts polling again and reappears
 * in the panel on the next tick, with their place in the queue intact. Deleting
 * their knock would have made them knock again and lose it.
 */
export function presentOnly(
  peers: readonly WaitingEntry[],
  nowMs: number,
  graceMs = PRESENCE_GRACE_MS,
): WaitingEntry[] {
  return peers.filter((p) => stillWaiting(p, nowMs, graceMs));
}

/**
 * How often a waiting guest's presence is actually written down.
 *
 * The poll runs every second and a half; this is what stops that becoming an
 * UPDATE every second and a half per waiting guest. Two costs are being bounded
 * and the second is the one that bites: `live_meeting_admissions` is in the
 * Realtime publication, and the host's panel subscribes to `*` on it — so an
 * unthrottled presence write would fire an event, a list re-apply and a
 * coalesced re-read on the host's screen every tick, for every person waiting.
 *
 * A third of the grace window, so a guest is written down at least twice before
 * they could ever be judged gone, and a single lost write cannot evict somebody
 * who is standing right there.
 */
export const PRESENCE_WRITE_MS = Math.floor(PRESENCE_GRACE_MS / 3);

/**
 * Whether this poll is the one that should record presence.
 *
 * Takes what the row already says rather than a timer, so it holds across
 * serverless invocations that share no memory — which is all of them.
 */
export function shouldRecordPresence(
  lastSeenAt: string | null | undefined,
  nowMs: number,
  writeEveryMs = PRESENCE_WRITE_MS,
): boolean {
  const seen = parseTime(lastSeenAt);
  // Never recorded, or recorded in a form we cannot read: write one, so the
  // row stops being indistinguishable from a guest who has gone.
  if (!seen) return true;
  // A row stamped in the future is a clock disagreeing, not a fresh poll. Left
  // alone rather than corrected: it reads as present, which is the safe way to
  // be wrong, and the next honest write will pass it.
  return nowMs - seen >= writeEveryMs;
}
