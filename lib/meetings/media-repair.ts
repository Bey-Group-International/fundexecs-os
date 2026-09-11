// lib/meetings/media-repair.ts
// Telling whether a peer connection is actually carrying the media it agreed to.
//
// Written for one specific, reported failure: a guest admitted from the waiting
// room hears the host and is seen BY the host, and the host's camera never
// arrives — permanently, on every browser, while a teammate joining at the same
// moment sees that same host fine and the guests see each other fine.
//
// Every direction on that connection works except one. That shape rules out the
// network (a connection carrying audio both ways and video one way is up), the
// browser (all four fail alike) and the join order (teammates join late too). It
// leaves the transceiver itself: either the sending side never attached the
// track, or the direction negotiated one-way.
//
// Both are invisible from the outside and neither is reconstructable after the
// call. So this module does two things: say precisely what a connection is
// carrying, and — for the one case that is safely repairable from the sending
// side — say that it needs repairing.
//
// Pure: no DOM, no logging, no side effects. The room decides what to do.

/** What one transceiver is actually doing, as opposed to what was asked for. */
export interface TransceiverState {
  kind: string;
  /** What this side wants. */
  direction: string;
  /** What was negotiated — null until the answer lands. */
  currentDirection: string | null;
  /** Whether a track is attached to send, and whether it could produce frames. */
  sending: { hasTrack: boolean; enabled: boolean; muted: boolean; readyState: string } | null;
  /** Whether anything is arriving. */
  receiving: { hasTrack: boolean; muted: boolean; readyState: string } | null;
}

/** The bits of RTCRtpTransceiver this reads, named so tests need no DOM. */
export interface TransceiverLike {
  direction: string;
  currentDirection?: string | null;
  receiver?: { track?: MediaStreamTrackLike | null } | null;
  sender?: { track?: MediaStreamTrackLike | null } | null;
}

export interface MediaStreamTrackLike {
  kind: string;
  enabled: boolean;
  muted: boolean;
  readyState: string;
}

function describeTrack(track: MediaStreamTrackLike | null | undefined) {
  if (!track) return null;
  return { kind: track.kind, enabled: track.enabled, muted: track.muted, readyState: track.readyState };
}

/**
 * What each transceiver on a connection is carrying.
 *
 * `kind` is taken from whichever track is present rather than from the
 * transceiver: a transceiver whose sender never got a track still has a
 * receiver track to name it, and a transceiver with neither is exactly the
 * thing worth seeing in the output.
 */
export function summarizeTransceivers(transceivers: readonly TransceiverLike[]): TransceiverState[] {
  return transceivers.map((tx) => {
    const sendTrack = tx.sender?.track ?? null;
    const recvTrack = tx.receiver?.track ?? null;
    const sending = describeTrack(sendTrack);
    const receiving = describeTrack(recvTrack);
    return {
      kind: sendTrack?.kind ?? recvTrack?.kind ?? "unknown",
      direction: tx.direction,
      currentDirection: tx.currentDirection ?? null,
      sending: sending ? { hasTrack: true, ...sending } : { hasTrack: false, enabled: false, muted: false, readyState: "none" },
      receiving: receiving ? { hasTrack: true, muted: receiving.muted, readyState: receiving.readyState } : { hasTrack: false, muted: false, readyState: "none" },
    };
  });
}

/** One line per transceiver, short enough to read in a console at a glance. */
export function formatTransceivers(states: readonly TransceiverState[]): string {
  if (states.length === 0) return "(no transceivers)";
  return states
    .map((s) => {
      const send = s.sending?.hasTrack
        ? `send=${s.sending.readyState}${s.sending.enabled ? "" : ",disabled"}${s.sending.muted ? ",muted" : ""}`
        : "send=NO TRACK";
      const recv = s.receiving?.hasTrack
        ? `recv=${s.receiving.readyState}${s.receiving.muted ? ",muted" : ""}`
        : "recv=none";
      return `${s.kind}: want=${s.direction} got=${s.currentDirection ?? "pending"} ${send} ${recv}`;
    })
    .join(" | ");
}

/**
 * Whether this peer's video sender is carrying the wrong thing.
 *
 * The one failure mode a sender can repair by itself: it holds no track, or a
 * track that has ended, while the local camera is live. Replacing it is
 * idempotent and needs no renegotiation, because the transceiver and its
 * m-line already exist — which is precisely why the connection can be up and
 * carrying audio while this one direction stays dark.
 *
 * Deliberately NOT true when the local track is absent (nothing to attach) or
 * when the sender already holds it. A disabled track is also left alone: that
 * is someone's camera switched off, not a fault, and replacing it would turn
 * their camera back on for everyone else.
 */
export function videoSenderNeedsRepair(
  senderTrack: MediaStreamTrackLike | null | undefined,
  localTrack: MediaStreamTrackLike | null | undefined,
): boolean {
  if (!localTrack) return false;
  if (localTrack.readyState === "ended") return false;
  if (!senderTrack) return true;
  if (senderTrack === localTrack) return false;
  return senderTrack.readyState === "ended";
}

/**
 * Whether a connected peer looks like it is failing to deliver video.
 *
 * Used to decide when saying something is worth the noise: a peer that has been
 * connected for a while, says its camera is on, and has produced no inbound
 * video track is the exact reported symptom and the moment the state above is
 * worth capturing.
 */
export function looksLikeMissingVideo(input: {
  connectionState: string;
  connectedForMs: number;
  peerSaysCameraOn: boolean;
  hasInboundVideoTrack: boolean;
  settleMs?: number;
}): boolean {
  const settle = input.settleMs ?? 5_000;
  if (input.connectionState !== "connected") return false;
  if (input.connectedForMs < settle) return false;
  if (!input.peerSaysCameraOn) return false;
  return !input.hasInboundVideoTrack;
}
