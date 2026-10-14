import { codecLeadFor, orderVideoCodecs, type CodecLike } from "./codec-preference";

const chromeCaps: CodecLike[] = [
  { mimeType: "video/VP8" },
  { mimeType: "video/rtx" },
  { mimeType: "video/VP9", sdpFmtpLine: "profile-id=0" },
  { mimeType: "video/VP9", sdpFmtpLine: "profile-id=2" },
  { mimeType: "video/H264", sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f" },
  { mimeType: "video/H264", sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" },
  { mimeType: "video/H264", sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f" },
  { mimeType: "video/AV1" },
  { mimeType: "video/red" },
  { mimeType: "video/ulpfec" },
  { mimeType: "video/flexfec-03" },
];

const mimes = (list: readonly CodecLike[] | null) => (list ?? []).map((c) => c.mimeType);

describe("codecLeadFor", () => {
  it("leads with hardware H.264 on Safari and on any phone", () => {
    expect(codecLeadFor({ family: "safari", mobile: false })).toBe("h264");
    expect(codecLeadFor({ family: "ios-safari", mobile: true })).toBe("h264");
    expect(codecLeadFor({ family: "ios-other", mobile: true })).toBe("h264");
    // Android Chrome is Chrome, and still a phone: the hardware wins.
    expect(codecLeadFor({ family: "chrome", mobile: true })).toBe("h264");
  });

  it("leads with VP9 on desktop Chrome and Edge", () => {
    expect(codecLeadFor({ family: "chrome", mobile: false })).toBe("vp9");
    expect(codecLeadFor({ family: "edge", mobile: false })).toBe("vp9");
  });

  it("leaves Firefox and unknown engines to their own order", () => {
    expect(codecLeadFor({ family: "firefox", mobile: false })).toBeNull();
    expect(codecLeadFor({ family: "other", mobile: false })).toBeNull();
  });
});

describe("orderVideoCodecs", () => {
  it("puts VP9 profile 0 first on a desktop lead, VP8 next as the universal fallback", () => {
    const out = orderVideoCodecs(chromeCaps, "vp9")!;
    expect(out[0]).toEqual({ mimeType: "video/VP9", sdpFmtpLine: "profile-id=0" });
    expect(out[1]).toEqual({ mimeType: "video/VP9", sdpFmtpLine: "profile-id=2" });
    expect(out[2].mimeType).toBe("video/VP8");
  });

  it("puts constrained-baseline H.264 first on a mobile lead", () => {
    const out = orderVideoCodecs(chromeCaps, "h264")!;
    expect(out[0].sdpFmtpLine).toContain("42e01f");
    expect(out[0].sdpFmtpLine).toContain("packetization-mode=1");
    // The other H.264 profiles follow, before any software codec.
    expect(out[1].mimeType).toBe("video/H264");
    expect(out[2].mimeType).toBe("video/H264");
    expect(out[3].mimeType).toBe("video/VP8");
  });

  // setCodecPreferences rejects a list that invents or drops an entry, and the
  // repair codecs are paired to a picture codec by payload type rather than
  // by position: they stay, at the end, in the order the engine listed them.
  it("keeps every entry and leaves the repair codecs at the end", () => {
    const out = orderVideoCodecs(chromeCaps, "vp9")!;
    expect(out).toHaveLength(chromeCaps.length);
    expect(mimes(out).slice(-4)).toEqual(["video/rtx", "video/red", "video/ulpfec", "video/flexfec-03"]);
    for (const codec of chromeCaps) expect(out).toContain(codec);
  });

  it("is stable within a rank, so the engine's own order survives", () => {
    const out = orderVideoCodecs(chromeCaps, "vp9")!;
    const h264 = out.filter((c) => c.mimeType === "video/H264").map((c) => c.sdpFmtpLine);
    expect(h264).toEqual(chromeCaps.filter((c) => c.mimeType === "video/H264").map((c) => c.sdpFmtpLine));
  });

  it("applies nothing when there is no lead, or the engine lacks the codec", () => {
    expect(orderVideoCodecs(chromeCaps, null)).toBeNull();
    const vp8Only: CodecLike[] = [{ mimeType: "video/VP8" }, { mimeType: "video/rtx" }];
    expect(orderVideoCodecs(vp8Only, "vp9")).toBeNull();
    expect(orderVideoCodecs(vp8Only, "h264")).toBeNull();
  });

  it("does not mutate the list it was handed", () => {
    const copy = [...chromeCaps];
    orderVideoCodecs(chromeCaps, "h264");
    expect(chromeCaps).toEqual(copy);
  });
});
