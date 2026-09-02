// Shared display formatting for the inbox board and its lazily-loaded
// conversation panel. It lives in its own module because the board reaches the
// panel only through a dynamic import — a static import in either direction
// would pull the panel back into the board's chunk and undo the split.

/** Compact absolute time, e.g. "Jul 3, 9:00 AM" — meeting, snooze and message labels. */
export function relativeMeeting(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
