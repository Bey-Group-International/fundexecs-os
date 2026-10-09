// lib/meetings/guest-report-link.ts
// How a guest gets to the report of the meeting they were just in.
//
// A guest has no account, so every page behind the app's auth wall is closed
// to them — including the report page for the meeting they sat through. Until
// now the thank-you screen offered them "request access" and nothing else: the
// summary of the conversation they had just had was the one thing the product
// could not show them.
//
// The room holds the two facts that prove who they are: the room code and the
// guest key their browser minted to knock with (lib/meetings/guest-key.ts).
// The public route takes both, checks the admission the host granted, and
// mints the same kind of signed, expiring link the summary email carries.
//
// Browser-safe and dependency-free: the thank-you screen calls this, and it
// must cost that screen nothing to import.

/** Where the link is minted. The key travels in the body, never the URL. */
export function guestReportLinkPath(roomCode: string): string {
  return `/api/meetings/public/${encodeURIComponent(roomCode)}/report-link`;
}

export interface GuestReportLink {
  /** The signed link; opens the summary without an account. */
  url: string;
  /**
   * Whether there is a report to read yet. False in the seconds after the
   * host presses End, and for a meeting the host has not ended at all: the
   * link still works, and the page it opens says to come back.
   */
  ready: boolean;
}

/** The subset of fetch this needs, so it can be tested without a network. */
type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Ask for the guest's link, or null when there is none to give.
 *
 * Null is a quiet answer on purpose. This is called from a screen that is
 * showing somebody out; a failure here — no service key on this deployment, a
 * guest whose admission the host revoked, a network blip — must not turn
 * "thanks for joining" into an error, and there is nothing the guest could do
 * about any of those anyway.
 */
export async function requestGuestReportLink(
  roomCode: string,
  guestKey: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<GuestReportLink | null> {
  const code = (roomCode ?? "").trim();
  const key = (guestKey ?? "").trim();
  if (!code || !key) return null;
  try {
    const res = await fetchImpl(guestReportLinkPath(code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestKey: key }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: unknown; ready?: unknown };
    if (typeof body.url !== "string" || !body.url) return null;
    return { url: body.url, ready: body.ready === true };
  } catch {
    return null;
  }
}
