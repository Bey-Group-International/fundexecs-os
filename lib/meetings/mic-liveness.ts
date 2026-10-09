// lib/meetings/mic-liveness.ts
// Whether the microphone is still delivering sound, and what to do when it is not.
//
// The camera has three ways to fail and the room watches all three: never
// starting (camera-liveness.ts), ending (the device-loss listener) and
// STALLING — the track stays `live`, fires `mute`, and the encoder goes on
// sending the last frame it was given. The microphone had the first two and
// not the third, and the third is worse for a microphone than for a camera. A
// frozen frame is at least visible to the person it happens to. A stalled
// microphone sends silence, silence is also what a listener who has not spoken
// yet sends, and so a member can talk to a room for ten minutes with nobody
// hearing a word and nothing on any screen saying so.
//
// What mutes a live audio track without ending it: Windows handing an
// exclusive-mode input to another application; a Bluetooth headset dropping
// its microphone profile while keeping its speakers; macOS switching the
// default input under a live capture; a phone taking a call or being put in a
// pocket. None of them fire `ended`, so the device-loss listener never sees
// them, and none of them change `enabled`, so the controls go on saying "live".
//
// Unlike the camera's stall, this does more than say so. Being heard is the
// floor of a call, and the repair the member would reach for — pick the same
// microphone again — is one the room can make itself. So the first stall
// reopens the microphone, and only a stall that survives that, or comes back
// soon after, is left to the notice. Bounded on purpose: a reopen that lands
// another muted track must not become a loop that reopens the microphone every
// few seconds for the rest of the meeting.
//
// Pure: no tracks, no timers. The room supplies what it sees.

/** What the room can observe about its own microphone, without acting on it. */
export interface MicFacts {
  /** What the controls claim — the member has not muted themselves. */
  on: boolean;
  readyState: string;
  /** The track's own report that no samples are arriving. */
  muted: boolean;
  /** The page is in the foreground. */
  visible: boolean;
  /** When this watch last reopened the microphone, or null if it never has. */
  lastReopenAt: number | null;
  now: number;
}

export type MicStallAction =
  /** Nothing to do: not a stall, or not one this can help. */
  | "ignore"
  /** Open the microphone again, the way the member would. */
  | "reopen"
  /** Reopening was tried recently. Tell them. */
  | "notice";

/**
 * What to do about a microphone that has gone quiet.
 *
 * A member who muted themselves has a disabled track that may also be muted
 * by the browser, and either way they asked for silence: nothing to fix. A
 * track that is not `live` belongs to the device-loss listener. A track that
 * is producing is fine whatever else is true.
 *
 * Hidden pages stand down. A phone that is backgrounded mutes its capture and
 * un-mutes it on return, so a reopen while hidden would either be refused or
 * would replace a track that was about to recover by itself. The room re-asks
 * when the page comes back, for the track that stayed muted after it did.
 */
export function micStallAction(facts: MicFacts): MicStallAction {
  if (!facts.on) return "ignore";
  if (facts.readyState !== "live") return "ignore";
  if (!facts.muted) return "ignore";
  if (!facts.visible) return "ignore";
  if (facts.lastReopenAt === null) return "reopen";
  if (facts.now - facts.lastReopenAt >= MIC_REOPEN_COOLDOWN_MS) return "reopen";
  return "notice";
}

/**
 * How long a microphone may stop delivering before anything is done.
 *
 * The same figure as the camera's stall, for the same reason: some hardware
 * blips `mute` around a profile change or a sample-rate switch, and acting on
 * every blip would reopen a microphone that was about to come back on its own.
 * A freshly opened track can also report `muted` for a moment before the
 * first buffer lands, and this is long enough not to condemn one that is
 * merely starting.
 */
export const MIC_STALL_MS = 4_000;

/**
 * How long after a reopen before another is worth trying.
 *
 * Long enough that a device which comes back muted every time is reopened
 * once and then reported, not reopened for the rest of the call; short enough
 * that a second, unrelated stall forty minutes later still gets the repair.
 */
export const MIC_REOPEN_COOLDOWN_MS = 60_000;

/** What the member is told. Names the causes they can actually act on. */
export const MIC_STALL_NOTICE =
  "Your microphone has stopped picking up sound — another app may have taken it over, or your "
  + "headset's microphone disconnected. Nobody can hear you until it comes back. The arrow beside "
  + "the mic button switches microphones.";
