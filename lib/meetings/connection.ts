// lib/meetings/connection.ts
// Keeping a mesh call up: who gets to offer, how much each sender may spend,
// what to give up first when the line gets thin, and when a stalled connection
// is worth retrying.
//
// A mesh has no server to absorb any of this. Every participant encodes and
// uploads a separate copy of their camera to every other participant, so the
// cost of one person's video is multiplied by the size of the room, and the
// first symptom of overspending is not a smaller picture — it is packet loss,
// which is heard as chopped, gargling audio long before it is seen. That is why
// the policy here is written around what to *stop* sending rather than around
// what the picture looks like.
//
// Pure: no RTCPeerConnection, no navigator, no timers. The browser calls belong
// in the component; the rules — who is polite, what a bad line is, how long to
// keep retrying — belong here where they can be tested.

/** How much video a participant may put on the wire in total, across all peers. */
const UPSTREAM_BUDGET_KBPS = 2400;

/** Never spend more than this on a single peer, however small the room. */
const PER_PEER_CEILING_KBPS = 1200;

/**
 * Below this a video stream is worse than none: the encoder spends the budget
 * on keyframes, the picture stalls anyway, and the bytes are taken from audio.
 */
const PER_PEER_FLOOR_KBPS = 150;

export type BandwidthMode = "normal" | "degraded" | "audio-only";

// ─── Perfect negotiation ─────────────────────────────────────────────────────

/**
 * Whether this side yields when two offers cross.
 *
 * Both peers can need to renegotiate at the same moment — an ICE restart on a
 * link that failed in both directions is the common one — and a connection that
 * receives an offer while it has one of its own outstanding is in an invalid
 * state for `setRemoteDescription`. The standard resolution ("perfect
 * negotiation") is for exactly one side to back down, so the roles have to be
 * decided from something both sides already agree on and neither can race: the
 * peer ids. Comparing them gives every pair a stable, opposite answer with no
 * extra signaling.
 *
 * The polite side rolls back its own offer and answers; the impolite side
 * ignores the incoming offer and lets its own complete.
 */
export function isPolite(localId: string, remoteId: string): boolean {
  return localId < remoteId;
}

/** What to do with an offer that arrived while we had one outstanding. */
export type CollisionAction = "accept" | "rollback_then_accept" | "ignore";

/**
 * Whether an incoming offer can be applied, and at what cost.
 *
 * `stable` is the ordinary case and needs no ceremony. Anything else is a
 * collision: the polite peer discards its own offer and answers this one, the
 * impolite peer drops this one on the floor. Dropping is safe precisely because
 * the other side is polite and will answer ours.
 */
export function offerCollision(input: {
  signalingState: RTCSignalingState;
  makingOffer: boolean;
  polite: boolean;
}): CollisionAction {
  const colliding = input.makingOffer || input.signalingState !== "stable";
  if (!colliding) return "accept";
  return input.polite ? "rollback_then_accept" : "ignore";
}

// ─── Send caps ───────────────────────────────────────────────────────────────

export interface SendCap {
  /** Bits per second for one peer's video sender. */
  maxBitrate: number;
  /** Divisor applied to the captured resolution before encoding. */
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

/**
 * What one video sender may spend, given how many people are in the room.
 *
 * Dividing a fixed upstream budget is the part that matters: without it a
 * five-way call asks a laptop to upload four copies of 720p30, which no ordinary
 * connection has, and the excess is dropped as loss on every stream including
 * the audio sharing the same path.
 *
 * Resolution and frame rate follow the bitrate rather than being chosen
 * separately. An encoder handed 720p and 250kbps produces a blurred, smeared
 * 720p; handed 360p and the same 250kbps it produces a clean 360p, which is the
 * better picture at the size a tile in a grid is actually drawn.
 */
export function videoSendCap(peerCount: number, mode: BandwidthMode = "normal"): SendCap | null {
  if (mode === "audio-only") return null;

  const peers = Math.max(1, Math.floor(peerCount));
  const share = UPSTREAM_BUDGET_KBPS / peers;
  // "degraded" is the step taken before giving up on video entirely, so it has
  // to be a real reduction rather than a gesture.
  const budget = mode === "degraded" ? share / 2 : share;
  const kbps = Math.round(Math.min(PER_PEER_CEILING_KBPS, Math.max(PER_PEER_FLOOR_KBPS, budget)));

  return {
    maxBitrate: kbps * 1000,
    scaleResolutionDownBy: kbps >= 900 ? 1 : kbps >= 450 ? 1.5 : kbps >= 250 ? 2 : 3,
    maxFramerate: kbps >= 450 ? 30 : kbps >= 250 ? 24 : 15,
  };
}

/**
 * The same, for a screen share.
 *
 * Shared screens are mostly still, so frames are cheap and detail is not: a
 * slide read at 8fps is fine and a slide read at half resolution is not. The
 * bitrate stays close to the camera's because a scrolling document briefly
 * costs as much as motion does.
 */
export function screenSendCap(peerCount: number, mode: BandwidthMode = "normal"): SendCap | null {
  const cap = videoSendCap(peerCount, mode);
  if (!cap) return null;
  return { maxBitrate: cap.maxBitrate, scaleResolutionDownBy: 1, maxFramerate: cap.maxFramerate >= 24 ? 15 : 8 };
}

// ─── Reading the line ────────────────────────────────────────────────────────

export interface LinkSample {
  /** Inbound kilobits per second, averaged over the peers we are receiving from. */
  kbps: number;
  /** Percentage of inbound packets lost since the last sample, 0-100. */
  lossPct: number;
  /**
   * Whether anyone in the room is currently trying to send us video.
   *
   * Without this a meeting where everyone has their camera off — an ordinary
   * thing to be in — reads as a starved link, because a voice call really does
   * cost about as little as a broken one delivers.
   */
  videoExpected: boolean;
}

export interface LinkState {
  mode: BandwidthMode;
  /** Consecutive samples that read as bad / as healthy. */
  bad: number;
  good: number;
}

export const INITIAL_LINK: LinkState = { mode: "normal", bad: 0, good: 0 };

/** Loss at which speech starts breaking up regardless of how many bits arrive. */
const BAD_LOSS_PCT = 8;
const GOOD_LOSS_PCT = 2;
/** Per-peer inbound rates. Aggregates hide a single starved stream in a big room. */
const BAD_KBPS = 90;
const GOOD_KBPS = 250;

/** Two bad samples to step down — one is a hiccup. */
const DOWN_AFTER = 2;
/** Three good ones to step back up: recovering too eagerly is how a call oscillates. */
const UP_AFTER = 3;

/**
 * What one measurement says about the line.
 *
 * The mode has to be an input, because below "normal" the inbound rate stops
 * being a measurement of the line and becomes a measurement of our own last
 * decision. Every participant on a bad link reduces what it sends; that lowers
 * what everyone receives; and a rule that reads a low rate as "still bad" then
 * has no way back — the room falls to audio-only on the first bad patch and
 * stays there for the rest of the call, however completely the network
 * recovers. Loss is the signal that keeps its meaning at any rate, so below
 * "normal" it is the only one consulted.
 *
 * A rate of zero is not evidence either way: it is what a call looks like
 * before its first frame lands, and what a dead link looks like after its last.
 */
function verdict(sample: LinkSample, mode: BandwidthMode): "bad" | "good" | "neither" {
  if (sample.lossPct >= BAD_LOSS_PCT) return "bad";

  // Packets arriving, and arriving intact.
  const clean = sample.kbps > 0 && sample.lossPct <= GOOD_LOSS_PCT;

  if (mode !== "normal") return clean ? "good" : "neither";

  // At full quality a rate this low means the line is starving a stream someone
  // is actually trying to push through it. With every camera off there is
  // nothing being starved and the same number is simply what voice costs.
  if (sample.videoExpected && sample.kbps > 0 && sample.kbps < BAD_KBPS) return "bad";
  return clean && sample.kbps >= GOOD_KBPS ? "good" : "neither";
}

const DOWN: Record<BandwidthMode, BandwidthMode> = {
  normal: "degraded",
  degraded: "audio-only",
  "audio-only": "audio-only",
};
const UP: Record<BandwidthMode, BandwidthMode> = {
  "audio-only": "degraded",
  degraded: "normal",
  normal: "normal",
};

/**
 * Advance the link state by one measurement.
 *
 * One step at a time, in both directions. The version this replaced went
 * straight from full video to audio-only the first time a number looked bad and
 * then straight back, so a call on a wobbling connection spent its length
 * flickering between "everyone is here" and "everyone is gone" — which reads as
 * a broken app rather than as a busy network. A halved bitrate in between is
 * usually enough, and is nearly invisible.
 *
 * `null` means there was nothing to measure (nobody else in the room, no stats
 * yet). That is not evidence either way, so the counters are left alone.
 */
export function stepLink(state: LinkState, sample: LinkSample | null): LinkState {
  if (!sample) return state;

  const v = verdict(sample, state.mode);
  if (v === "bad") {
    const bad = state.bad + 1;
    if (bad >= DOWN_AFTER && DOWN[state.mode] !== state.mode) {
      return { mode: DOWN[state.mode], bad: 0, good: 0 };
    }
    return { mode: state.mode, bad, good: 0 };
  }

  if (v === "good") {
    const good = state.good + 1;
    if (good >= UP_AFTER && UP[state.mode] !== state.mode) {
      return { mode: UP[state.mode], bad: 0, good: 0 };
    }
    return { mode: state.mode, bad: 0, good };
  }

  // In between: neither confirms a problem nor clears one. Forget the partial
  // streak in each direction rather than letting stale evidence accumulate.
  return { mode: state.mode, bad: 0, good: 0 };
}

/** What to tell the room about the current mode, or nothing when all is well. */
export function linkNotice(mode: BandwidthMode): string | null {
  if (mode === "degraded") return "Weak connection — video quality reduced";
  if (mode === "audio-only") return "Weak connection — video paused to keep audio clear";
  return null;
}

// ─── Recovering a stalled connection ─────────────────────────────────────────

/**
 * How long a connection may sit in `disconnected` before we call it a problem.
 *
 * Most do not: a Wi-Fi roam or a phone changing cell drops a couple of seconds
 * of packets and ICE repairs itself. Reacting instantly would tear down and
 * rebuild connections that were about to come back on their own, and would put
 * a "Reconnecting" badge on the screen several times per call for no reason.
 */
export const DISCONNECT_GRACE_MS = 2500;

/** Restarting forever is a battery drain and a signaling flood; this is the cap. */
const MAX_ICE_ATTEMPTS = 5;
/** Backoff between attempts, so a peer that is simply gone is not hammered. */
const RESTART_BACKOFF_MS = [0, 2000, 4000, 8000, 15000];

export interface RecoveryState {
  attempts: number;
  /** When the last restart was asked for. */
  lastAttemptAt: number;
}

export const INITIAL_RECOVERY: RecoveryState = { attempts: 0, lastAttemptAt: 0 };

export type RecoveryAction = "restart" | "wait" | "give_up";

/**
 * Whether to ask ICE to try again.
 *
 * `wait` and `give_up` are deliberately different answers: the first means come
 * back in a moment, the second means this peer is not coming back and the UI
 * should say so instead of spinning indefinitely.
 */
export function nextRecovery(state: RecoveryState, now: number): RecoveryAction {
  if (state.attempts >= MAX_ICE_ATTEMPTS) return "give_up";
  const backoff = RESTART_BACKOFF_MS[Math.min(state.attempts, RESTART_BACKOFF_MS.length - 1)];
  if (state.attempts > 0 && now - state.lastAttemptAt < backoff) return "wait";
  return "restart";
}

/** Record that a restart was issued. */
export function recordAttempt(state: RecoveryState, now: number): RecoveryState {
  return { attempts: state.attempts + 1, lastAttemptAt: now };
}

export type PeerLinkStatus = "connecting" | "live" | "reconnecting" | "lost";

/**
 * What a tile should say about its peer.
 *
 * `msSinceChange` is what keeps the grace period out of the component: a
 * connection that has been `disconnected` for 400ms is still "live" as far as
 * anyone watching is concerned, and only becomes "reconnecting" once it has
 * been away long enough to be worth mentioning.
 */
export function peerLinkStatus(
  connectionState: RTCPeerConnectionState,
  msSinceChange: number,
  gaveUp = false,
): PeerLinkStatus {
  if (gaveUp) return "lost";
  switch (connectionState) {
    case "connected":
      return "live";
    case "new":
    case "connecting":
      return "connecting";
    case "disconnected":
      return msSinceChange < DISCONNECT_GRACE_MS ? "live" : "reconnecting";
    case "failed":
      return "reconnecting";
    case "closed":
      return "lost";
    default:
      return "connecting";
  }
}

/**
 * The ICE state read as a connection state.
 *
 * `RTCPeerConnection.connectionState` is the right thing to watch — it accounts
 * for DTLS as well as ICE — but it is not universally present, and a badge that
 * cannot tell "connecting" from "connected" sticks on "Connecting…" over video
 * that is plainly working. The ICE state is always there and answers the only
 * question the badge is asking: can media flow.
 */
export function connectionStateFromIce(ice: RTCIceConnectionState): RTCPeerConnectionState {
  switch (ice) {
    case "connected":
    case "completed":
      return "connected";
    case "checking":
      return "connecting";
    case "disconnected":
      return "disconnected";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
    default:
      return "new";
  }
}

/** The badge text for a tile, or null when there is nothing worth saying. */
export function peerStatusLabel(status: PeerLinkStatus): string | null {
  if (status === "connecting") return "Connecting…";
  if (status === "reconnecting") return "Reconnecting…";
  if (status === "lost") return "Connection lost";
  return null;
}

// ─── Audio resilience ────────────────────────────────────────────────────────

/**
 * Ask Opus to protect itself against loss, in the one place it can be asked.
 *
 * `useinbandfec=1` makes the encoder carry a low-rate copy of the previous
 * frame inside the current one, so a single lost packet is reconstructed rather
 * than heard as a click or a gap — which is most of what "static" on a call
 * actually is. It costs a few percent of bitrate and is the cheapest audio
 * quality available on a lossy link.
 *
 * There is no API for it: the only way to set an Opus parameter is to edit the
 * SDP between `createOffer`/`createAnswer` and `setLocalDescription`. Chrome
 * offers FEC by default, Safari and some Firefox builds have not, and a call is
 * only as good as its worst leg — so it is stated explicitly on every leg.
 *
 * Deliberately conservative: it only touches the fmtp line of a payload type
 * already negotiated as Opus, never adds or reorders codecs, and returns the
 * SDP untouched when there is no Opus to configure. An SDP munge that guesses
 * is worse than none.
 */
export function withOpusResilience(sdp: string): string {
  if (!sdp) return sdp;

  const payloadTypes = new Set<string>();
  for (const m of sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/48000/gim)) payloadTypes.add(m[1]);
  if (payloadTypes.size === 0) return sdp;

  const wanted: Array<[string, string]> = [
    ["useinbandfec", "1"],
    // Mono. Stereo doubles the cost of a voice that has no second channel, and
    // the extra bits are exactly what a thin line cannot afford.
    ["stereo", "0"],
  ];
  const defaults = wanted.map(([k, v]) => `${k}=${v}`).join(";");

  // SDP is CRLF by spec, but a munged or hand-written one may not be; keep
  // whatever this one uses rather than converting it.
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const configured = new Set<string>();
  const out: string[] = [];

  for (const line of sdp.split(/\r\n|\n/)) {
    const fmtp = /^a=fmtp:(\d+)\s+(.*)$/.exec(line);
    if (fmtp && payloadTypes.has(fmtp[1])) {
      configured.add(fmtp[1]);
      const params = fmtp[2].split(";").map((p) => p.trim()).filter(Boolean);
      const keys = new Set(params.map((p) => p.split("=")[0]));
      for (const [key, value] of wanted) if (!keys.has(key)) params.push(`${key}=${value}`);
      out.push(`a=fmtp:${fmtp[1]} ${params.join(";")}`);
      continue;
    }

    out.push(line);

    // A payload type announced with no fmtp line of its own gets one, placed
    // straight after its rtpmap so it stays inside the same media section.
    const rtpmap = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line);
    if (rtpmap && !configured.has(rtpmap[1]) && !new RegExp(`^a=fmtp:${rtpmap[1]}\\s`, "im").test(sdp)) {
      configured.add(rtpmap[1]);
      out.push(`a=fmtp:${rtpmap[1]} ${defaults}`);
    }
  }

  return out.join(eol);
}

/**
 * What a track is for, so the encoder optimises for the right thing.
 *
 * The defaults are reasonable but generic: without a hint a screen share is
 * encoded as if it were a face, which spends the budget smoothing motion that
 * is not there and blurs the text that is.
 */
export function contentHintFor(kind: "camera" | "screen" | "microphone"): string {
  if (kind === "screen") return "detail";
  if (kind === "camera") return "motion";
  return "speech";
}
