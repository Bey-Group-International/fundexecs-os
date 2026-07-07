// lib/office/floor-link.ts
// Canonical builder for Executive Floor invite links. Every room has its own
// stable, shareable link (`/command-center?room=<key>`); a video-meeting link
// adds `&meet=1` so opening it drops the invitee into the host's room and
// auto-opens the video dock. Shared by the client (copy-link / roster) and the
// server (invite email) so the two never drift.

export type FloorLinkOptions = {
  /** Target room key — the invitee is teleported here on arrival. */
  room?: string | null;
  /** When true, the office auto-opens the meeting video dock on arrival. */
  meet?: boolean;
};

/** The path + query for an office invite (no origin). */
export function officeInvitePath(opts: FloorLinkOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.room) params.set("room", opts.room);
  if (opts.meet) params.set("meet", "1");
  const qs = params.toString();
  return `/command-center${qs ? `?${qs}` : ""}`;
}

/** A fully-qualified office invite URL for a given origin. */
export function officeInviteUrl(origin: string, opts: FloorLinkOptions = {}): string {
  const base = (origin || "").replace(/\/$/, "");
  return `${base}${officeInvitePath(opts)}`;
}
