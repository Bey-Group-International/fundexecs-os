// lib/meetings/codec-preference.ts
// Which video codec to ask for, and on what kind of machine.
//
// The browser's default order puts VP8 first on every engine, because it is
// the one codec every WebRTC endpoint has had for a decade. It is also the
// worst of the three on offer by a clear margin, in two different directions:
//
//  - A phone or a Mac has an H.264 encoder in hardware. VP8 on those runs in
//    software, which is the warm phone and the hour of battery a video call
//    costs on an iPhone — and on Safari, H.264 is the only codec the hardware
//    helps with at all.
//
//  - A desktop Chrome or Edge has a VP9 encoder that gives roughly the same
//    picture for 30% fewer bits than VP8, on a mesh where every member uploads
//    a copy to every other member and upload is the scarce thing.
//
// So the order is decided here, by platform, and applied with
// `setCodecPreferences` on the transceiver before the offer is made. VP8 stays
// in the list everywhere as the fallback that always negotiates: a preference
// changes the order, never the set, so two members who disagree still connect.
//
// Pure: no RTCRtpReceiver. The room passes the capability list in.

import type { BrowserFamily } from "@/lib/meetings/green-room";

/** The part of an RTCRtpCodecCapability the ordering reads. */
export interface CodecLike {
  mimeType: string;
  sdpFmtpLine?: string;
}

/** Which encoder to lead with, or null to leave the browser's order alone. */
export type CodecLead = "h264" | "vp9" | null;

/**
 * What to lead with on this machine.
 *
 * Safari in every form, and anything on a phone, leads with H.264: that is
 * where the hardware is. Desktop Chrome and Edge lead with VP9. Firefox and
 * anything unrecognised are left alone — Firefox's VP9 encoder has been
 * slow enough in practice that forcing it is a gamble, and a codec order on
 * an unknown engine is a guess about hardware nobody has looked at.
 */
export function codecLeadFor(input: { family: BrowserFamily; mobile: boolean }): CodecLead {
  if (input.mobile) return "h264";
  switch (input.family) {
    case "safari":
    case "ios-safari":
    case "ios-other":
      return "h264";
    case "chrome":
    case "edge":
      return "vp9";
    default:
      return null;
  }
}

/** Mime types that carry no picture of their own: retransmission and repair. */
const AUXILIARY = new Set(["video/rtx", "video/red", "video/ulpfec", "video/flexfec-03"]);

function rank(codec: CodecLike, lead: Exclude<CodecLead, null>): number {
  const mime = codec.mimeType.toLowerCase();
  const fmtp = (codec.sdpFmtpLine ?? "").toLowerCase();
  if (lead === "h264") {
    // Constrained Baseline with packetization-mode=1 is the profile every
    // hardware encoder and every other endpoint agrees on; other H.264
    // entries follow, then the software codecs.
    if (mime === "video/h264") return fmtp.includes("packetization-mode=1") && fmtp.includes("42e0") ? 0 : 1;
    if (mime === "video/vp8") return 2;
    if (mime === "video/vp9") return 3;
    return 4;
  }
  if (mime === "video/vp9") {
    // Profile 0 is 8-bit 4:2:0, which is what a camera produces and what
    // every VP9 decoder plays. Profile 2 is 10-bit and not worth negotiating
    // for a face.
    return fmtp.includes("profile-id=0") || !fmtp.includes("profile-id") ? 0 : 1;
  }
  if (mime === "video/vp8") return 2;
  if (mime === "video/h264") return 3;
  return 4;
}

/**
 * The capability list reordered to lead with the chosen codec.
 *
 * Every entry is kept and nothing is invented: `setCodecPreferences` rejects
 * a codec it was not offered, and dropping one would narrow what can be
 * negotiated with a member on a different engine. The retransmission and
 * repair entries keep their place at the end — they are paired to a codec by
 * payload type, not by position, and leaving them behind is what keeps the
 * list acceptable to every engine that validates it. The sort is stable, so
 * within a rank the browser's own order survives.
 *
 * Null when there is no preference to apply, so the caller does not call
 * `setCodecPreferences` at all and the browser's order stands untouched.
 */
export function orderVideoCodecs<T extends CodecLike>(codecs: readonly T[], lead: CodecLead): T[] | null {
  if (!lead) return null;
  const primary = codecs.filter((c) => !AUXILIARY.has(c.mimeType.toLowerCase()));
  const auxiliary = codecs.filter((c) => AUXILIARY.has(c.mimeType.toLowerCase()));
  // A preference for a codec this engine cannot do is no preference.
  if (!primary.some((c) => c.mimeType.toLowerCase() === `video/${lead}`)) return null;
  const ordered = primary
    .map((codec, index) => ({ codec, index, rank: rank(codec, lead) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.codec);
  return [...ordered, ...auxiliary];
}
