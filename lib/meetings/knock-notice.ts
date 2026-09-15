// lib/meetings/knock-notice.ts
// Telling a host that somebody is standing at the door.
//
// A guest's wait is usually not the waiting room being slow. It is the host not
// knowing. The room already answers that two ways, and both of them stop at the
// edge of the browser window: a chime, which is unheard if the tab is muted or
// the host is on a call in another app, and a count in the tab title, which
// needs the host to be looking at their tabs. Neither reaches somebody who has
// switched to a document, a terminal, or a different application entirely —
// which is exactly the host who leaves a guest outside for four minutes.
//
// A system notification does reach them. It is also the most intrusive thing
// this product can do to someone, so the rules for firing one are narrow, and
// they live here where they can be stated and tested rather than spread across
// an effect.
//
// Pure: no Notification, no document. The component supplies what it sees.

/** `Notification.permission`, plus the case where the API does not exist. */
export type NotificationPermissionLike = "default" | "granted" | "denied" | "unsupported";

export interface KnockAlert {
  title: string;
  body: string;
}

export interface KnockAlertInput {
  isHost: boolean;
  /** How many are waiting now, and how many were a moment ago. */
  waiting: number;
  previousWaiting: number;
  /** Whether the meeting tab is hidden. A visible tab already shows the bar. */
  hidden: boolean;
  permission: NotificationPermissionLike;
  /** The name of the person who just knocked, when there is exactly one. */
  name?: string | null;
}

/**
 * Whether to raise a system notification, and what it should say.
 *
 * Every condition here is a way of not firing:
 *
 *  - Only the host. Nobody else can admit anyone, so for everyone else this
 *    would be an interruption with no action attached to it.
 *  - Only on a rise. Admitting three of four people drops the count, and a
 *    notification on the way down would fire for something the host just did.
 *  - Only when the tab is hidden. A host looking at the meeting has the waiting
 *    bar in front of them and has already heard the chime; a notification on top
 *    of that is noise, and noise is what gets notifications turned off.
 *  - Only when already granted. Asking is a separate decision made at a moment
 *    the host is expecting it — see shouldRequestNotificationPermission.
 */
export function knockAlert(input: KnockAlertInput): KnockAlert | null {
  if (!input.isHost) return null;
  if (input.permission !== "granted") return null;
  if (!input.hidden) return null;
  if (input.waiting <= 0 || input.waiting <= input.previousWaiting) return null;

  const name = input.name?.trim();
  const title = input.waiting > 1
    ? `${input.waiting} people are waiting to join`
    : name
      ? `${name} is waiting to join`
      : "Someone is waiting to join";

  return { title, body: "Open the meeting to let them in." };
}

/**
 * Whether to ask for notification permission.
 *
 * Only the host, and only if they have neither granted nor refused. A refusal
 * is an answer: browsers remember it, re-prompting is not possible without the
 * user going into settings, and treating "denied" as a question to ask again is
 * how a product earns a permanently blocked origin.
 *
 * WHEN this is called matters as much as whether. It belongs on the host's own
 * click to start or join — a prompt that appears out of nowhere on page load is
 * the one everybody dismisses, and some browsers refuse to show it at all
 * outside a user gesture.
 */
export function shouldRequestNotificationPermission(
  input: { isHost: boolean; permission: NotificationPermissionLike },
): boolean {
  return input.isHost && input.permission === "default";
}
