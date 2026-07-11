// lib/office/floor-link.ts
// Canonical builder for Executive Floor invite links. Every room has its own
// stable, shareable link (`/virtual-office?room=<key>`); a video-meeting link
// adds `&meet=1` so opening it drops the invitee into the host's room and
// auto-opens the video dock. Shared by the client (copy-link / roster) and the
// server (invite email) so the two never drift. The path comes from the
// centralized route table so the Command Center → Virtual Office rename can't
// leave invite URLs pointing at the old (redirecting) path.
import { virtualOfficeRoutes } from "@/lib/virtualOfficeRoutes";

export type FloorLinkOptions = {
  /** Target room key — the invitee is teleported here on arrival. */
  room?: string | null;
  /** When true, the office auto-opens the meeting video dock on arrival. */
  meet?: boolean;
  /**
   * Marketplace listing id this link convenes a deal room around. When present,
   * the Deal Room shows that listing's context on arrival, so a counterparty who
   * opens the link lands in the same deal room with the same context.
   */
  deal?: string | null;
  /**
   * Single-use invite token (see lib/office/invite-tokens.ts). When present the
   * office validates and consumes it on arrival before joining, so a per-invitee
   * link can't be forwarded, reused, or replayed after it expires.
   */
  invite?: string | null;
};

/** The path + query for an office invite (no origin). */
export function officeInvitePath(opts: FloorLinkOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.room) params.set("room", opts.room);
  if (opts.meet) params.set("meet", "1");
  if (opts.deal) params.set("deal", opts.deal);
  if (opts.invite) params.set("invite", opts.invite);
  const qs = params.toString();
  return `${virtualOfficeRoutes.root}${qs ? `?${qs}` : ""}`;
}

/** A fully-qualified office invite URL for a given origin. */
export function officeInviteUrl(origin: string, opts: FloorLinkOptions = {}): string {
  const base = (origin || "").replace(/\/$/, "");
  return `${base}${officeInvitePath(opts)}`;
}
