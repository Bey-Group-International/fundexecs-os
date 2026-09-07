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
}

export interface WaitingEntry {
  id: string;
  from: string;
  displayName: string;
}

export type AdmissionChange =
  | { eventType: "INSERT" | "UPDATE"; new: WaitingRow }
  | { eventType: "DELETE"; old: { id?: string } };

export function toEntry(row: WaitingRow): WaitingEntry {
  return { id: row.id, from: row.guest_key, displayName: row.display_name };
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
