// lib/meetings/prompt-meeting.ts
// The room code a meeting page is showing, read from its path, so a prompt
// sent from that page can carry it (resolved server-side in
// prompt-meeting.server.ts). Pure; safe in the browser.

export const ROOM_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** The room code in a meeting page's path ("/meetings/<code>/…"), or null. */
export function roomCodeFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/meetings\/([^/?#]+)/.exec(pathname ?? "");
  if (!m) return null;
  // The meetings section's own pages, which are not rooms.
  if (["calls", "device-check", "record"].includes(m[1])) return null;
  return ROOM_CODE.test(m[1]) ? m[1] : null;
}
