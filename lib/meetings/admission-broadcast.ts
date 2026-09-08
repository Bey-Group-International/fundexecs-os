// lib/meetings/admission-broadcast.ts
// Telling a waiting guest, from the server, that their answer is ready.
//
// Published over Realtime rather than written anywhere, because there is
// nothing to store: the decision is already in live_meeting_admissions, and
// this only says when to go and read it. See admission-channel.ts for why the
// message carries no verdict and why each guest gets their own channel.
//
// Best-effort by construction. Every guest still polls on a safety-net cadence,
// so a nudge that fails to publish costs at most a few seconds of somebody's
// time — which is a far better trade than failing the host's admit because a
// notification could not be delivered. Nothing here is allowed to throw into
// the request that made the decision.

import { ADMISSION_NUDGE, admissionChannelName } from "./admission-channel";

/** The bit of the Supabase client this needs, so tests need not build one. */
export interface BroadcastCapable {
  channel: (name: string) => {
    httpSend?: (event: string, payload: unknown) => Promise<unknown>;
    send?: (args: { type: string; event: string; payload: unknown }) => Promise<unknown>;
  };
}

/**
 * Nudge each of `guestKeys` that their decision has changed.
 *
 * Sent over HTTP rather than a socket: this runs in a request handler that is
 * about to end, and holding a WebSocket open long enough to publish on it would
 * cost more than the notification is worth. `httpSend` is the current spelling;
 * `send` on an unsubscribed channel does the same thing on older clients and is
 * kept as a fallback so a version bump cannot silently stop the nudges.
 *
 * Failures are counted and returned rather than thrown, so a caller can log
 * them without the decision itself depending on delivery.
 */
export async function nudgeGuests(
  supabase: BroadcastCapable,
  roomCode: string,
  guestKeys: readonly string[],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  await Promise.all(
    guestKeys.map(async (guestKey) => {
      try {
        const channel = supabase.channel(admissionChannelName(roomCode, guestKey));
        if (typeof channel.httpSend === "function") {
          await channel.httpSend(ADMISSION_NUDGE, {});
        } else if (typeof channel.send === "function") {
          await channel.send({ type: "broadcast", event: ADMISSION_NUDGE, payload: {} });
        } else {
          failed += 1;
          return;
        }
        sent += 1;
      } catch {
        failed += 1;
      }
    }),
  );

  return { sent, failed };
}
