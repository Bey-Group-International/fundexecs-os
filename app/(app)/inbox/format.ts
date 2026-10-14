// Shared display formatting for the inbox board and its lazily-loaded
// conversation panel. It lives in its own module because the board reaches the
// panel only through a dynamic import — a static import in either direction
// would pull the panel back into the board's chunk and undo the split.

/** Compact absolute time, e.g. "Jul 3, 9:00 AM" — meeting, snooze and message labels. */
export function relativeMeeting(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The time on an inbox row, Gmail-style: the clock time for today, the date for
 * earlier this year, and the full short date for anything older.
 */
export function rowTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}
