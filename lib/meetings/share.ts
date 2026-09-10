// lib/meetings/share.ts
// The one place that knows what a meeting's shareable link looks like.
//
// The invite URL used to be rebuilt inline wherever it was needed — the room
// footer, the people panel, the control bar — which is how you end up with one
// surface handing out a link and another handing out a bare room code. Pure and
// client-safe on purpose: `lib/meetings/service.ts` also builds this URL, but it
// reaches for the audit writer and cannot be imported into a client component.

export interface MeetingShareDetails {
  origin: string;
  roomCode: string;
  title?: string | null;
  scheduledAt?: string | null;
  timeZone?: string | null;
}

export interface ShareTarget {
  title: string;
  text: string;
  url: string;
}

/** Minimal shape of the bits of `navigator` sharing needs, so this stays testable. */
export interface ShareCapableNavigator {
  share?: (data: ShareTarget) => Promise<void>;
  canShare?: (data: unknown) => boolean;
}

const DEFAULT_TITLE = "FundExecs meeting";

/**
 * The link a member copies out of the app.
 *
 * `/meeting-invite/` rather than `/meetings/` deliberately: the invite route is
 * the one that works for someone who has never signed in, and a link that is
 * only good for people who already have an account is not a shareable link.
 */
export function meetingInviteUrl(origin: string, roomCode: string): string {
  const code = roomCode?.trim() ?? "";
  if (!code) return "";
  return `${(origin ?? "").trim().replace(/\/+$/, "")}/meeting-invite/${encodeURIComponent(code)}`;
}

/** When the meeting is, phrased for a person, or "" if there's nothing to say. */
export function formatMeetingWhen(scheduledAt: string | null | undefined, timeZone?: string | null): string {
  if (!scheduledAt) return "";
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return "";

  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      ...(timeZone ? { timeZone } : {}),
    }).format(at);
  } catch {
    // An invalid IANA zone throws rather than falling back, and a bad timezone
    // stored on a meeting must not take out the share button with it.
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  }
}

/**
 * What to hand the OS share sheet.
 *
 * `text` deliberately omits the URL: most share targets append `url` themselves,
 * and the ones that don't get it from the `url` field anyway — including it in
 * both is how a shared message ends up with the link in it twice.
 */
export function shareTargetFor(details: MeetingShareDetails): ShareTarget {
  const title = details.title?.trim() || DEFAULT_TITLE;
  const when = formatMeetingWhen(details.scheduledAt, details.timeZone);
  return {
    title,
    text: when ? `${title} — ${when}` : title,
    url: meetingInviteUrl(details.origin, details.roomCode),
  };
}

/**
 * The whole invitation, as text, ready to paste into an email or a chat.
 *
 * "Copy link" and "Copy invite" are two different jobs and one button cannot do
 * both: pasting a bare URL into a thread that already says what the meeting is
 * is right, and pasting that same bare URL into a cold email to an LP is not —
 * they get a link with no idea what it opens or when it starts. So the URL stays
 * on its own button and this one carries the context with it.
 *
 * The time is written in the meeting's own zone AND labelled with it (via
 * formatMeetingWhen), because this text is copied precisely when it is about to
 * cross into somebody else's timezone.
 *
 * Lines are omitted rather than left blank when there is nothing to say, so an
 * unscheduled meeting produces a two-line invite instead of one with a hole
 * where the date should be.
 */
export function inviteTextFor(details: MeetingShareDetails): string {
  const url = meetingInviteUrl(details.origin, details.roomCode);
  if (!url) return "";

  const title = details.title?.trim() || DEFAULT_TITLE;
  const when = formatMeetingWhen(details.scheduledAt, details.timeZone);

  return [title, when ? `When: ${when}` : null, `Join: ${url}`]
    .filter(Boolean)
    .join("\n");
}

/**
 * Whether to offer a native share button at all.
 *
 * Rendering one that throws `NotAllowedError` on click is worse than not
 * rendering it, so this checks `canShare` for the actual payload where the
 * browser offers it rather than assuming `share` alone means yes.
 */
export function canNativeShare(nav: ShareCapableNavigator | null | undefined, target: ShareTarget): boolean {
  if (!nav || typeof nav.share !== "function") return false;
  if (!target.url) return false;
  if (typeof nav.canShare === "function") {
    try {
      return nav.canShare(target);
    } catch {
      return false;
    }
  }
  return true;
}

/** A link short enough to sit in a row without pushing everything else out. */
export function displayUrl(url: string, max = 44): string {
  const bare = url.replace(/^https?:\/\//, "");
  if (bare.length <= max) return bare;
  // Truncate the middle: the tail carries the room code, which is the part
  // someone reads to confirm they're about to share the right meeting.
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${bare.slice(0, head)}…${bare.slice(bare.length - tail)}`;
}
