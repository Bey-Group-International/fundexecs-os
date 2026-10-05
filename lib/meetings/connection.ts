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

// ─── How a peer connection is configured ─────────────────────────────────────

/**
 * The connection policy every peer in a call is built with.
 *
 * Both fields exist for the same reason and it is a guest's reason: how many
 * separate network paths one peer connection has to build before anybody can be
 * seen or heard.
 *
 * A call carries audio and video, which is two m-sections. Under the default
 * `balanced` policy a browser prepares to run those on separate transports and
 * only collapses them once BUNDLE is agreed in the answer — so until then it
 * gathers two sets of candidates, runs two sets of connectivity checks and,
 * where a relay is involved, holds TWO TURN allocations. `max-bundle` puts
 * everything in one bundle group in the offer itself, so there is one transport
 * from the start.
 *
 * `require` says the same thing about RTCP: multiplexed onto the media port
 * rather than given a port of its own, which is another candidate set and
 * another set of checks per m-section.
 *
 * Nobody pays more for this than a guest. They are the participant most likely
 * to be behind the NAT that needs a relay in the first place, so halving the
 * allocations and the checking halves the slowest part of their join — and
 * halves what the relay is asked to hold open for them.
 *
 * Safe to state unilaterally: every browser that can run this app has supported
 * BUNDLE and rtcp-mux for years, and both ends of every connection here are
 * this same code.
 *
 * Deliberately NOT here: `iceCandidatePoolSize`. Pre-gathering only helps when
 * a connection exists well before its offer, and in this room a peer connection
 * is created and offered on in the same breath — so a pool would buy nothing
 * and would open a TURN allocation per pooled candidate to buy it with.
 */
export function peerConfig(
  iceServers: RTCIceServer[],
  opts: { relayOnly?: boolean } = {},
): RTCConfiguration {
  const config: RTCConfiguration = {
    iceServers,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
  // Only set when forcing it. Left undefined the browser uses "all", and
  // writing that explicitly would say a decision was made where none was.
  if (opts.relayOnly) config.iceTransportPolicy = "relay";
  return config;
}

/**
 * Whether to put this participant's media through the relay and nothing else.
 *
 * Invite-link guests are the one population always on somebody else's network —
 * a corporate firewall, hotel wifi, mobile CGNAT, symmetric NAT — and they are
 * the population whose calls fail. Sending them straight to the relay skips the
 * direct path that was going to fail anyway, so their call forms on the first
 * attempt instead of after a failure, a restart and a several-second stall.
 *
 * The condition is not "is a guest". It is "is a guest AND we actually have a
 * relay to send them to". Relay-only with no relay server in the configuration
 * leaves a peer connection with no usable candidates at all: it cannot fail
 * over to a direct path, because it has been told not to have one. A guest on
 * an ordinary home network would go from a call that worked to a call that
 * could not physically connect. So a deployment with no TURN configured, or one
 * whose credentials were refused, keeps the old behaviour and a guest keeps
 * whatever chance a direct path gives them.
 */
export function shouldForceRelay(input: { isGuest: boolean; relayAvailable: boolean }): boolean {
  return input.isGuest && input.relayAvailable;
}

/**
 * How long to wait for a relay candidate before concluding there will not be one.
 *
 * A TURN allocation is one request and one reply over an already-open socket, so
 * a server that is going to answer answers in well under a second; this is slack
 * for a slow mobile link, not a budget. It only ever matters when the allocation
 * is NOT going to succeed — gathering ends by itself when it does — and in that
 * case it is the whole cost of the mistake, so it is short.
 */
export const RELAY_PROBE_MS = 3_000;

/** The parts of an ICE candidate that say whether it came from a relay. */
export interface CandidateLike {
  /** Populated by every engine that implements RTCIceCandidate.type. */
  type?: string | null;
  /** The raw a=candidate line, which always carries the type. */
  candidate?: string | null;
}

/**
 * Whether this candidate is an address on a relay.
 *
 * Read from `type` where the engine provides it and parsed from the candidate
 * line where it does not — the line is normative and present everywhere, and a
 * candidate that arrived as plain JSON (a buffered one, a test fixture) has the
 * line and no `type` at all.
 *
 * The end-of-candidates signal is an empty candidate, which is not a relay and
 * must not be read as one.
 */
export function isRelayCandidate(candidate: CandidateLike | null | undefined): boolean {
  if (!candidate) return false;
  if (typeof candidate.type === "string" && candidate.type.length > 0) return candidate.type === "relay";
  const line = candidate.candidate ?? "";
  return / typ relay(\s|$)/.test(line);
}

/** What a relay-only connection has managed to do so far. */
export interface RelayProbe {
  /** Whether this client was told to use the relay and nothing else. */
  relayOnly: boolean;
  /** Whether a candidate of type `relay` has been gathered. */
  sawRelay: boolean;
  /** Whether the browser has finished gathering: no more candidates are coming. */
  gatheringComplete: boolean;
  /** How long gathering has been running. */
  elapsedMs: number;
  /** Whether a relay-only connection has reached `failed`. */
  failed: boolean;
}

/**
 * Whether to stop insisting on the relay and let this client try a direct path.
 *
 * `shouldForceRelay` guards on whether a relay was CONFIGURED, which is the only
 * thing the endpoint handing out credentials can know. It is not the same
 * question as whether the relay WORKS. Credentials are minted from a secret, or
 * issued by a provider, without anybody allocating anything — so a TURN server
 * that is down, whose shared secret no longer matches, whose monthly quota is
 * spent, or that this network cannot reach, is indistinguishable from a healthy
 * one at the moment the policy is chosen.
 *
 * On a relay-only connection that difference is total. `iceTransportPolicy:
 * "relay"` removes the host and server-reflexive candidates, so a failed
 * allocation leaves the connection with NO candidates: it cannot fail over to a
 * direct path because it has been told not to have one. There is nothing to
 * retry, no state change to react to, and nothing in the UI that distinguishes
 * it from a peer who has not finished joining. A guest on an ordinary home
 * network — who would have connected directly without ever needing the relay —
 * simply never appears for anybody, and the host sits looking at a tile that
 * stays empty for the whole meeting.
 *
 * So the policy is provisional, and these are the three ways it is withdrawn:
 *
 *  - gathering finished and produced no relay candidate. Conclusive: the
 *    allocation was refused or the server never answered, and no further
 *    candidate is coming.
 *  - the deadline passed with no relay candidate. The same conclusion for a
 *    server that neither answers nor refuses, where gathering can hang.
 *  - a relay candidate WAS gathered and the connection still failed. The relay
 *    exists but cannot carry this call; a direct path is the only thing left to
 *    try, and "all" is a superset of "relay" so nothing is given up by asking
 *    for it.
 *
 * Withdrawing it is strictly a widening — every candidate the relay-only
 * connection had is still allowed — so the worst case of being wrong is a direct
 * path that is attempted and fails, which is what every non-guest already does.
 */
export function shouldAbandonRelayOnly(probe: RelayProbe): boolean {
  if (!probe.relayOnly) return false;
  if (probe.sawRelay) return probe.failed;
  return probe.gatheringComplete || probe.elapsedMs >= RELAY_PROBE_MS;
}

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

/**
 * Whether an offer we have just built can be applied to this connection.
 *
 * `stable` is the ordinary case. `have-local-offer` is the one that matters and
 * the one a plain `=== "stable"` check gets wrong: a connection whose offer was
 * never answered — the peer's tab froze, its network went away mid-handshake —
 * stays in `have-local-offer` for good. That is EXACTLY the connection ICE
 * recovery exists to rescue, and a stable-only guard made every rescue attempt
 * bail before sending anything. The attempts were still counted, so after five
 * silent no-ops the peer was marked permanently lost and the only way back was
 * a page reload: the failure the recovery path was written to prevent.
 *
 * Re-offering there is legal — setLocalDescription with an offer is defined for
 * `stable` and `have-local-offer`, and in the latter it replaces the pending
 * local description, which is what an ICE restart wants.
 *
 * Everything else genuinely cannot take one. `have-remote-offer` in particular
 * means the far end got in first while we were building ours; theirs is the one
 * that survives, and the answer path handles it.
 */
export function canSetLocalOffer(signalingState: RTCSignalingState): boolean {
  return signalingState === "stable" || signalingState === "have-local-offer";
}

// ─── Saying hello ────────────────────────────────────────────────────────────

/**
 * Why this client should announce itself, or null when it should stay quiet.
 *
 * `join` is the ONLY message in this protocol that makes anybody build a peer
 * connection to us. Nothing else in the room ever creates one from nothing: an
 * offer is a reply to a join, an answer is a reply to an offer, and an ICE
 * candidate belongs to a connection that already exists. So a join that does
 * not arrive is not a message lost — it is a participant who is in the meeting,
 * with their camera and microphone open and the room drawn around them, whom
 * nobody else can see or hear. It cannot heal, and the only cure is a reload
 * that nothing tells them to perform.
 *
 * It is sent over a broadcast socket, fire and forget, at the worst moment a
 * call has: immediately after a WebSocket handshake, on whatever network the
 * participant is on. An invite-link guest pays that twice over — they are the
 * population always on somebody else's network, and theirs is the hello sent
 * last, after a wait in the waiting room.
 *
 * Three reasons, and the middle one is the one that was missing:
 *
 *   `first`   — the opening hello of the call.
 *   `alone`   — we hold no live peer connection. Either nobody is here, in
 *               which case this costs one small message that nobody receives,
 *               or somebody IS here and has not heard us, which is exactly the
 *               state above. The two are indistinguishable from inside this
 *               client, and only one of them is a failure, so it re-announces.
 *   `stalled` — we hold connections and at least one is not up, so a rebuild
 *               has something to rebuild.
 *
 * What this replaced tested only the third, and so could never fire in the
 * first: `some()` over an empty collection is false, and the participant with
 * no peers is precisely the participant whose hello went missing. A socket
 * reconnect — the one event that would naturally have put it right — looked at
 * an empty map, concluded there was nothing to repair, and said nothing.
 *
 * A `closed` connection is not counted as held. It carries no media and we are
 * the ones who closed it, so a map of nothing but closed entries is `alone` by
 * any meaning the room cares about.
 */
export type AnnounceReason = "first" | "alone" | "stalled";

export function announceReason(input: {
  /** True for the first successful subscribe of this call, false on a resubscribe. */
  first: boolean;
  /** `connectionState` of every peer connection this client currently holds. */
  peerStates: readonly RTCPeerConnectionState[];
}): AnnounceReason | null {
  if (input.first) return "first";
  const held = input.peerStates.filter((state) => state !== "closed");
  if (held.length === 0) return "alone";
  return held.some((state) => state !== "connected") ? "stalled" : null;
}

/**
 * How long to wait before saying hello again when nobody has answered.
 *
 * The thing being waited for is cheap and fast: a peer ENTRY appears the moment
 * the far end's offer lands, which is one broadcast round trip and nothing to
 * do with ICE, media or a relay. So the first step only has to outlast a slow
 * WebSocket hop, not a connection — long enough that an answer in flight is not
 * mistaken for silence, short enough that a lost hello is repaired before
 * anybody has finished saying "I can't see you".
 *
 * Then it stretches, and settles into a slow heartbeat rather than stopping.
 * Stopping is what the old code did, and an unanswered hello does not become
 * less wrong with time: the host whose socket was down for two minutes still
 * needs to be told that somebody is in their meeting.
 */
export const REANNOUNCE_STEPS_MS = [3_000, 6_000, 12_000] as const;

/** The resting cadence once the opening steps are spent. */
export const REANNOUNCE_CADENCE_MS = 30_000;

export function reannounceDelayMs(priorAttempts: number): number {
  const spent = Number.isFinite(priorAttempts) ? Math.max(0, Math.floor(priorAttempts)) : 0;
  return spent < REANNOUNCE_STEPS_MS.length ? REANNOUNCE_STEPS_MS[spent] : REANNOUNCE_CADENCE_MS;
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
  const kbps = cap.maxBitrate / 1000;
  return {
    maxBitrate: cap.maxBitrate,
    // Resolution is held for as long as the bitrate can carry it, and given up
    // only when it cannot — the same rule as the camera ladder above, at a
    // different point on the curve because text survives a low frame rate and
    // does not survive a low bitrate at full size.
    //
    // Pinning this at 1 unconditionally was the defect: below the floor the
    // encoder was being told to keep every pixel of a 1440p or larger capture
    // on a few hundred kilobits, which produces a smear in which nothing is
    // readable — losing the legibility the full resolution was protecting. Half
    // resolution at the same bitrate is a picture somebody can actually read.
    scaleResolutionDownBy: kbps >= SCREEN_FULL_RES_FLOOR_KBPS ? 1 : 2,
    maxFramerate: cap.maxFramerate >= 24 ? 15 : 8,
  };
}

/**
 * The bitrate below which a shared screen is better off at half resolution.
 *
 * Chosen from what a mesh actually provides rather than from an ideal: the
 * budget is 2400kbps total, so this is the point at about four other people
 * where full resolution stops being affordable.
 */
const SCREEN_FULL_RES_FLOOR_KBPS = 600;

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

/** What arrived from one peer since the last sample. */
export interface PeerInboundRate {
  id: string;
  /** Kilobits per second, across every inbound stream on that connection. */
  kbps: number;
}

/**
 * Turn a round of per-peer stats into one measurement, or null for none.
 *
 * The rate is the WORST stream we are expecting video on, not the average of
 * the room. That distinction is the whole point and the version this replaces
 * got it backwards: it summed every peer's bytes and divided by the peer count,
 * under a comment claiming that this was "per peer, not in total" and that an
 * aggregate "hides one starved stream behind three healthy ones". A mean is an
 * aggregate. It hid the starved stream exactly as well as the sum would have,
 * and it invented starvation that was not there — every silent participant
 * dragged the average down, and Opus DTX had just been turned on to make silent
 * participants cost nothing at all. A seven-person call with one camera on
 * averaged about 37kbps and read as a dying link.
 *
 * `expectingVideoFrom` is the other half, and it is about what we ASKED for
 * rather than what the far end says its camera is doing. Those are different
 * questions the moment this tab goes to the background: every tier drops to
 * `none`, the peers stop sending video exactly as instructed, and their cameras
 * are still on — so the old rule expected video that it had itself cancelled,
 * found none, and reported a weak connection. Switching tabs for ten seconds
 * was enough to start it.
 *
 * With nothing to expect video from, the mean is reported instead. It is not
 * used to condemn the line — `verdict` only reads a low rate when video is
 * expected — and it is still what tells a recovering link that packets are
 * flowing at all.
 */
export function summarizeInbound(input: {
  rates: readonly PeerInboundRate[];
  /** Peers we have asked for video AND who say they are sending it. */
  expectingVideoFrom: ReadonlySet<string>;
  lostPackets: number;
  deliveredPackets: number;
}): LinkSample | null {
  if (input.rates.length === 0) return null;

  const expecting = input.rates.filter((r) => input.expectingVideoFrom.has(r.id));
  const kbps = expecting.length > 0
    ? Math.min(...expecting.map((r) => r.kbps))
    : input.rates.reduce((total, r) => total + r.kbps, 0) / input.rates.length;

  return {
    kbps: Number.isFinite(kbps) ? Math.max(0, kbps) : 0,
    lossPct: input.deliveredPackets > 0 ? (input.lostPackets / input.deliveredPackets) * 100 : 0,
    videoExpected: expecting.length > 0,
  };
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

/**
 * The opening burst of restarts, and the gaps between them.
 *
 * Front-loaded because most recoverable failures recover in the first few
 * seconds: a Wi-Fi roam, a cell handover, a NAT binding that expired. The burst
 * spans about twenty-nine seconds in total, and that number is the whole reason
 * for everything below it — it is how long a member will wait before deciding
 * the call is broken, and it is nowhere near long enough to be how long the
 * NETWORK gets before we stop trying.
 */
export const ICE_BURST_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = [0, 2000, 4000, 8000, 15000];

/**
 * How often to keep trying once the burst is spent.
 *
 * The version this replaces stopped after the burst and never tried again. A
 * laptop asleep for a minute, a train tunnel, a slow Wi-Fi handover — anything
 * longer than those twenty-nine seconds — left every tile reading "Connection
 * lost" for the rest of the meeting with no way back but a page reload, for
 * both ends at once, because each had given up on the other. The outage did not
 * have to be severe. It had to be slightly longer than the retry budget.
 *
 * Twenty seconds apart costs one ICE restart and one offer per peer per twenty
 * seconds, which is nothing next to the media the call is already carrying, and
 * it means a network that comes back at any point during the meeting finds a
 * call still trying to reach it.
 */
export const ICE_RETRY_CADENCE_MS = 20_000;

/**
 * When to stop entirely.
 *
 * Measured from the first attempt rather than counted in attempts, because what
 * is being judged is how long the peer has been unreachable, not how many times
 * we asked. Ten minutes is past any outage a meeting survives socially: someone
 * gone that long has left, and their tile should stop pretending otherwise.
 */
export const ICE_GIVE_UP_MS = 10 * 60_000;

export interface RecoveryState {
  attempts: number;
  /** When the last restart was asked for. */
  lastAttemptAt: number;
  /**
   * When this run of trouble began, for the give-up horizon.
   *
   * Meaningless until `attempts` is non-zero, and read nowhere else. Kept
   * separate from `lastAttemptAt` so that clearing the backoff — which is what
   * a network returning does — cannot also extend the horizon.
   */
  firstAttemptAt: number;
}

export const INITIAL_RECOVERY: RecoveryState = { attempts: 0, lastAttemptAt: 0, firstAttemptAt: 0 };

export type RecoveryAction = "restart" | "wait" | "give_up";

/**
 * Whether to ask ICE to try again.
 *
 * Three answers, and the middle one is the one that used to be missing. `wait`
 * means come back when the backoff is up. `give_up` means this peer has been
 * unreachable for longer than a meeting outlasts and nothing more will be
 * attempted. Running out of the opening burst is NEITHER of those — it is worth
 * telling the member about (see `recoveryExhausted`) and is not a reason to
 * stop, so past the burst this keeps answering `restart` on a slow cadence
 * until the horizon.
 */
export function nextRecovery(state: RecoveryState, now: number): RecoveryAction {
  if (state.attempts === 0) return "restart";
  if (now - state.firstAttemptAt >= ICE_GIVE_UP_MS) return "give_up";
  return msUntilNextAttempt(state, now) > 0 ? "wait" : "restart";
}

/**
 * How long until this peer is due for another attempt.
 *
 * Exported so the caller can sleep exactly that long. The version this replaces
 * re-checked every 1500ms regardless, which was wasteful against a fifteen-
 * second backoff and would have been absurd against the cadence above.
 */
export function msUntilNextAttempt(state: RecoveryState, now: number): number {
  if (state.attempts === 0) return 0;
  const backoff = state.attempts < RESTART_BACKOFF_MS.length
    ? RESTART_BACKOFF_MS[state.attempts]
    : ICE_RETRY_CADENCE_MS;
  const waited = now - state.lastAttemptAt;
  if (!Number.isFinite(waited)) return 0;
  return Math.max(0, backoff - waited);
}

/**
 * Whether the opening burst is spent — the moment a member deserves to be told.
 *
 * This is what drives the "Connection lost" badge, and it is deliberately NOT
 * what drives whether we keep trying. Saying so on the screen and giving up
 * underneath it were the same flag before, which is how an honest badge turned
 * into a permanent one.
 */
export function recoveryExhausted(state: RecoveryState): boolean {
  return state.attempts >= ICE_BURST_ATTEMPTS;
}

/**
 * Drop the backoff, because something happened that the backoff did not know.
 *
 * The delays above are guesses about a network nobody can see. When the browser
 * says the machine is online again, the guess is superseded: waiting out the
 * rest of a twenty-second cadence would be waiting for no reason. The attempt
 * count and the horizon are untouched, so this cannot be used to retry forever.
 */
export function withImmediateRetry(state: RecoveryState): RecoveryState {
  return { ...state, lastAttemptAt: 0 };
}

/** Record that a restart was issued. */
export function recordAttempt(state: RecoveryState, now: number): RecoveryState {
  return {
    attempts: state.attempts + 1,
    lastAttemptAt: now,
    // Stamped from the attempt count rather than from the value, so a first
    // attempt that lands on a zero clock still starts the horizon.
    firstAttemptAt: state.attempts === 0 ? now : state.firstAttemptAt,
  };
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
  /** The opening burst of restarts is spent. Retries continue underneath. */
  lost = false,
): PeerLinkStatus {
  if (lost) return "lost";
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
 * `usedtx=1` is the other half of the trade, and it pays in a mesh the way
 * nothing else here does. In a six-person call five people are listening at any
 * moment, and each of them is uploading a separate constant-bitrate stream of
 * their own silence to every other participant. DTX stops transmitting when
 * there is nothing to say and sends an occasional comfort-noise frame instead,
 * so the cost of a room full of quiet listeners falls to almost nothing — and
 * the bandwidth that frees is bandwidth the person actually talking gets to
 * use. The cost is real but small: some engines clip a few milliseconds off the
 * front of a word after a silence, and the comfort noise under a pause is
 * synthetic rather than the room.
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
    // Stop paying to transmit silence. Most people in a meeting are listening.
    ["usedtx", "1"],
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
