/**
 * FundExecs OS — WebRTC inbound-stream stats (pure).
 *
 * Turns two `RTCStatsReport` snapshots of an inbound video track into the
 * human-facing numbers a stream HUD shows — bitrate, framerate, packet loss —
 * by differencing the cumulative counters over the sample interval. Kept pure
 * (no DOM, no `RTCPeerConnection`) so the math is unit-testable; `StreamPlayer`
 * feeds it real samples from `pc.getStats()`.
 */

/** A minimal inbound-rtp sample pulled from an `RTCStatsReport`. */
export type InboundSample = {
  /** Sample time in ms (the stat's `timestamp`). */
  tMs: number;
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  framesDecoded: number;
};

/** Derived, display-ready stats over one interval. */
export type StreamStats = {
  bitrateKbps: number;
  fps: number;
  /** Packet loss over the interval, percent (one decimal). */
  packetLossPct: number;
};

/** A loosely-typed RTCStats entry (the browser type varies across libs). */
type StatLike = {
  type?: string;
  kind?: string;
  mediaType?: string;
  timestamp?: number;
  bytesReceived?: number;
  packetsReceived?: number;
  packetsLost?: number;
  framesDecoded?: number;
};

/**
 * Pull the inbound video sample from an iterable of RTCStats entries (an
 * `RTCStatsReport` is iterable). Returns `null` if no inbound video track is
 * present yet. `nowMs` is a fallback timestamp for entries missing one.
 */
export function extractInboundSample(stats: Iterable<StatLike>, nowMs: number): InboundSample | null {
  for (const s of stats) {
    const isVideo = s.kind === "video" || s.mediaType === "video";
    if (s.type === "inbound-rtp" && isVideo) {
      return {
        tMs: s.timestamp ?? nowMs,
        bytesReceived: s.bytesReceived ?? 0,
        packetsReceived: s.packetsReceived ?? 0,
        packetsLost: s.packetsLost ?? 0,
        framesDecoded: s.framesDecoded ?? 0,
      };
    }
  }
  return null;
}

/**
 * Compute display stats from consecutive samples. Counter deltas are clamped at
 * zero (counters only rise; a reset/track-swap must not read as negative), and
 * the interval is floored at 1ms to avoid divide-by-zero on same-tick samples.
 */
export function computeStats(prev: InboundSample, cur: InboundSample): StreamStats {
  const dtSec = Math.max(1, cur.tMs - prev.tMs) / 1000;
  const bits = Math.max(0, cur.bytesReceived - prev.bytesReceived) * 8;
  const frames = Math.max(0, cur.framesDecoded - prev.framesDecoded);
  const dPackets = Math.max(0, cur.packetsReceived - prev.packetsReceived);
  const dLost = Math.max(0, cur.packetsLost - prev.packetsLost);
  const denom = dPackets + dLost;
  return {
    bitrateKbps: Math.round(bits / dtSec / 1000),
    fps: Math.round(frames / dtSec),
    packetLossPct: denom > 0 ? Math.round((dLost / denom) * 1000) / 10 : 0,
  };
}

/** A compact one-line label for a HUD, e.g. "1,850 kbps · 30 fps · 0.4% loss". */
export function formatStats(s: StreamStats): string {
  return `${s.bitrateKbps.toLocaleString()} kbps · ${s.fps} fps · ${s.packetLossPct}% loss`;
}
