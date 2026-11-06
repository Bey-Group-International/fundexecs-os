// Documents in the data rooms that are waiting on the fund's own signature.
//
// Two flows can leave a file waiting on the fund:
//   - an envelope: a reader signed through the shared signing flow, and every
//     other recipient has signed, so the owner's turn is next (status
//     "partially_signed"); and
//   - a legacy file signature: a reader signed through the older per-link flow and
//     the fund has not counter-signed yet.
// Both are listed together, grouped by room, so nothing sits unseen in a room the
// operator is not currently looking at.

export interface SignatureTask {
  /** Stable key: kind + id. */
  key: string;
  kind: "envelope" | "legacy";
  /** The envelope id or the legacy signature id. */
  id: string;
  title: string;
  roomId: string;
  roomName: string;
  signerName: string | null;
  signerEmail: string | null;
  /** When the reader signed; the task has waited since. ISO timestamp. */
  signedAt: string | null;
}

export interface RoomSignatureGroup {
  roomId: string;
  roomName: string;
  tasks: SignatureTask[];
}

/** Group tasks by room (rooms in first-seen order), longest-waiting first within a room. */
export function groupSignatureTasks(tasks: SignatureTask[]): RoomSignatureGroup[] {
  const groups = new Map<string, RoomSignatureGroup>();
  for (const t of tasks) {
    const g = groups.get(t.roomId) ?? { roomId: t.roomId, roomName: t.roomName, tasks: [] };
    g.tasks.push(t);
    groups.set(t.roomId, g);
  }
  const waited = (t: SignatureTask) => (t.signedAt ? Date.parse(t.signedAt) : Number.POSITIVE_INFINITY);
  return [...groups.values()].map((g) => ({ ...g, tasks: [...g.tasks].sort((a, b) => waited(a) - waited(b)) }));
}

/** "3 documents need your signature", "1 document needs your signature", "Nothing needs your signature". */
export function signatureSummary(count: number): string {
  if (count === 0) return "Nothing needs your signature.";
  return `${count} document${count === 1 ? "" : "s"} ${count === 1 ? "needs" : "need"} your signature.`;
}

/** Whole days since an ISO timestamp, never negative; null when unknown. */
export function daysWaiting(signedAt: string | null, now: Date = new Date()): number | null {
  if (!signedAt) return null;
  const ms = now.getTime() - Date.parse(signedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function waitingLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "signed today";
  return days === 1 ? "waiting 1 day" : `waiting ${days} days`;
}
