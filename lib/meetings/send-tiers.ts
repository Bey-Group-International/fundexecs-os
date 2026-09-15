// lib/meetings/send-tiers.ts
// Sending each person only the picture they are actually looking at.
//
// A mesh call encodes the camera once per peer, so at six guests every laptop
// runs six encoders and uploads six streams. Splitting one budget evenly across
// them — which is what this replaces — spends the same on a 96px thumbnail in
// the strip as on the speaker filling the screen. In a meeting where one person
// presents, that is almost the entire cost: five of six streams are paying for
// detail nobody can see, at a resolution nobody is drawing, while the one person
// being watched is starved down to a fraction of the budget.
//
// The fix is available in a mesh and not in an SFU: every peer connection is
// separate, so each can carry a different encoding. Receivers say what size they
// are drawing someone at, and senders encode to that. Nothing here talks to a
// PeerConnection — it decides, and the room applies.
//
// Pure: no DOM, no WebRTC, no timers.

import type { BandwidthMode, SendCap } from "@/lib/meetings/connection";

/**
 * What one receiver wants from one sender.
 *
 *  - `high` — drawn large: the spotlight, or a one-to-one call.
 *  - `low`  — drawn small: a thumbnail in the strip, or a cell in a busy grid.
 *  - `none` — not drawn at all: the tab is in the background, or their camera
 *    is off. The encoder stops, which is the only lever that removes CPU cost
 *    rather than reducing it.
 */
export type VideoTier = "high" | "low" | "none";

/** Total video a participant may put on the wire, across every peer. */
const UPSTREAM_BUDGET_KBPS = 2400;
/** Never spend more than this on one peer, however few there are. */
const PER_PEER_CEILING_KBPS = 1200;
/** Below this a stream is worse than none — see connection.ts. */
const PER_PEER_FLOOR_KBPS = 150;

/**
 * What a thumbnail costs.
 *
 * The strip is 96px tall, so about 170px wide. 320x180 at 15fps covers that
 * with room to spare, and 180kbps is generous for it. The point is the ratio:
 * six thumbnails cost about a megabit between them, where six evenly-split
 * streams cost the entire budget and look worse doing it.
 */
const THUMBNAIL_KBPS = 180;
/** Exported: the room reads it to tell a thumbnail cap from a full-size one. */
export const THUMBNAIL_SCALE = 4;
const THUMBNAIL_FPS = 15;

/** Above this many tiles, a grid cell is small enough to be a thumbnail. */
const GRID_THUMBNAIL_THRESHOLD = 4;

/**
 * What this viewer needs from one other participant.
 *
 * Deliberately decided from the LAYOUT rather than by measuring the element:
 * a tile's rendered size changes while a resize is animating, and quality that
 * follows it would renegotiate on every frame of a window drag.
 */
export function tierForView(input: {
  /** Whether the page is visible at all. */
  documentHidden: boolean;
  /** Whether this participant is the one in the spotlight. */
  isSpotlight: boolean;
  /** "speaker" puts one person large and the rest in a strip; "grid" is even. */
  layout: "speaker" | "grid";
  /** How many tiles the grid is drawing, including the viewer's own. */
  tileCount: number;
  /** What they say their camera is doing; no point asking for a black frame. */
  cameraOn: boolean;
}): VideoTier {
  if (input.documentHidden) return "none";
  if (!input.cameraOn) return "none";
  if (input.layout === "speaker") return input.isSpotlight ? "high" : "low";
  // A grid of two or three still draws each tile large enough to be worth real
  // bitrate; past that they are thumbnails whatever the layout is called.
  return input.tileCount > GRID_THUMBNAIL_THRESHOLD ? "low" : "high";
}

/**
 * How long someone keeps full quality after they stop being the spotlight.
 *
 * The active speaker is chosen from the audio meter, which moves every time
 * somebody says "mm" — so in any real conversation the spotlight changes several
 * times a minute, and often several times in a few seconds. Following that
 * exactly would drop the previous speaker to a quarter resolution and raise them
 * back moments later, and every one of those changes costs a keyframe and a
 * visible blip on everyone's screen.
 *
 * So the rule is asymmetric: promote at once, because the new speaker should be
 * sharp immediately, and demote only after they have been quiet for a while.
 * Cross-talk and short interjections then cost nothing at all.
 */
const DEMOTE_LINGER_MS = 4_000;

/**
 * Hold a peer at `high` for a moment after they stop being watched.
 *
 * `none` is never held: a backgrounded tab or a camera switched off should stop
 * the far encoder immediately, which is the saving that matters most and the one
 * a delay would throw away.
 */
export function withDemotionDelay(input: {
  desired: VideoTier;
  /** When this peer was last genuinely wanted at `high`, or null if never. */
  lastHighAt: number | null;
  now: number;
  lingerMs?: number;
}): VideoTier {
  if (input.desired === "high" || input.desired === "none") return input.desired;
  if (input.lastHighAt === null) return input.desired;
  const linger = input.lingerMs ?? DEMOTE_LINGER_MS;
  return input.now - input.lastHighAt < linger ? "high" : input.desired;
}

/** How long a held promotion lasts, so a caller can schedule the re-check. */
export const DEMOTION_LINGER_MS = DEMOTE_LINGER_MS;

const THUMBNAIL_CAP: SendCap = {
  maxBitrate: THUMBNAIL_KBPS * 1000,
  scaleResolutionDownBy: THUMBNAIL_SCALE,
  maxFramerate: THUMBNAIL_FPS,
};

/**
 * What to spend on each peer, given what each of them asked for.
 *
 * Thumbnails are paid first, at a flat rate, because their cost does not depend
 * on how many there are — and whatever they do not use goes to the people being
 * watched. That is the whole gain: in a six-guest meeting with one presenter,
 * the presenter goes from an even sixth of the budget to nearly all of it, and
 * the other five drop to a fifth of what they were spending.
 *
 * A peer that has asked for nothing yet is treated as `high`. That is what the
 * even split used to give everyone, so a room containing a client too old to
 * send a request behaves exactly as it did before.
 */
export function allocateSendCaps(
  requests: ReadonlyMap<string, VideoTier>,
  peerIds: readonly string[],
  mode: BandwidthMode = "normal",
): Map<string, SendCap | null> {
  const out = new Map<string, SendCap | null>();
  if (mode === "audio-only") {
    for (const id of peerIds) out.set(id, null);
    return out;
  }

  const tiers = peerIds.map((id) => ({ id, tier: requests.get(id) ?? "high" as VideoTier }));
  const highs = tiers.filter((t) => t.tier === "high");
  const lows = tiers.filter((t) => t.tier === "low");

  // "degraded" halves what is left for the people being watched, and leaves
  // thumbnails alone: they are already at the floor of what is worth sending.
  const budget = UPSTREAM_BUDGET_KBPS - lows.length * THUMBNAIL_KBPS;
  const forHighs = mode === "degraded" ? budget / 2 : budget;
  const share = highs.length > 0 ? forHighs / highs.length : 0;
  const highKbps = Math.round(Math.min(PER_PEER_CEILING_KBPS, Math.max(PER_PEER_FLOOR_KBPS, share)));

  for (const { id, tier } of tiers) {
    if (tier === "none") { out.set(id, null); continue; }
    if (tier === "low") { out.set(id, THUMBNAIL_CAP); continue; }
    out.set(id, {
      maxBitrate: highKbps * 1000,
      // Same ladder as connection.ts: resolution follows the bitrate, because
      // 720p at 250kbps is a smeared 720p and 360p at 250kbps is a clean 360p.
      scaleResolutionDownBy: highKbps >= 900 ? 1 : highKbps >= 450 ? 1.5 : highKbps >= 250 ? 2 : 3,
      maxFramerate: highKbps >= 450 ? 30 : highKbps >= 250 ? 24 : 15,
    });
  }
  return out;
}

/**
 * Total upstream this allocation puts on the wire, in kbps.
 *
 * Exported so the saving can be asserted rather than asserted about: the tests
 * use it to pin what a presenter-shaped six-guest call actually costs.
 */
export function totalUpstreamKbps(caps: ReadonlyMap<string, SendCap | null>): number {
  let total = 0;
  for (const cap of caps.values()) if (cap) total += cap.maxBitrate / 1000;
  return Math.round(total);
}

/** How many encoders are actually running — the number that heats a laptop. */
export function activeEncoderCount(caps: ReadonlyMap<string, SendCap | null>): number {
  let n = 0;
  for (const cap of caps.values()) if (cap) n += 1;
  return n;
}

// ─── What the camera itself should run at ────────────────────────────────────

// Everything above decides what the ENCODERS do. The camera underneath them was
// always opened at 720p and left there, so a laptop in a presented meeting
// captures 720p thirty times a second, scales each frame down four times over
// for four thumbnails, and throws the detail away. The capture and the scaling
// are both real CPU, they are paid whether or not anybody is looking, and on a
// phone they are paid out of the battery.
//
// So the camera follows demand too. The rule is the simplest one that cannot
// surprise anybody: the capture serves the LARGEST thing anyone has asked for.
// One person spotlighting you is enough to keep it at 720p, because the cost of
// being wrong in that direction is a visibly soft picture for the one person
// actually watching.

export interface CaptureSize {
  width: number;
  height: number;
  frameRate: number;
}

export const FULL_CAPTURE: CaptureSize = { width: 1280, height: 720, frameRate: 30 };

/**
 * Enough for a thumbnail with room to spare.
 *
 * 640x360 rather than the 320x180 a thumbnail is drawn at: a capture mode has
 * to be one the camera actually supports, 360p is universally available where
 * 180p is not, and leaving the encoder something to scale keeps the edges of a
 * face from crawling.
 */
export const THUMBNAIL_CAPTURE: CaptureSize = { width: 640, height: 360, frameRate: 30 };

/**
 * A cap's resolution divisor, corrected for the capture actually in effect.
 *
 * This is the part that makes the whole idea safe, and the reason it is here
 * rather than inline: `scaleResolutionDownBy` is a divisor, so it means a
 * different output size on every capture size. A thumbnail's scale of 4 is
 * 320x180 out of a 1280-wide capture and 160x90 out of a 640-wide one — so
 * dropping the capture without correcting the divisor would quietly halve every
 * thumbnail in the call, which is the opposite of the intent.
 *
 * The caps are written against 720p because that is what the camera opens at.
 * Rescaling them against the real capture height keeps the OUTPUT fixed while
 * the input moves, and the floor of 1 is what stops a small capture being
 * upscaled back to a size it has no detail for.
 */
export function scaleForCapture(scaleFrom720: number, captureHeight: number): number {
  if (!Number.isFinite(scaleFrom720) || scaleFrom720 <= 0) return 1;
  if (!Number.isFinite(captureHeight) || captureHeight <= 0) return scaleFrom720;
  return Math.max(1, (scaleFrom720 * captureHeight) / FULL_CAPTURE.height);
}
