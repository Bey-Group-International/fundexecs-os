import {
  computeStats,
  extractInboundSample,
  formatStats,
  type InboundSample,
} from "./streamStats";

describe("extractInboundSample", () => {
  it("pulls the inbound video sample from a stats report", () => {
    const report = [
      { type: "outbound-rtp", kind: "video", bytesSent: 10 },
      { type: "inbound-rtp", kind: "audio", bytesReceived: 5 },
      { type: "inbound-rtp", kind: "video", timestamp: 1000, bytesReceived: 2000, packetsReceived: 100, packetsLost: 1, framesDecoded: 30 },
    ];
    expect(extractInboundSample(report, 0)).toEqual({
      tMs: 1000,
      bytesReceived: 2000,
      packetsReceived: 100,
      packetsLost: 1,
      framesDecoded: 30,
    });
  });

  it("accepts the mediaType alias for kind", () => {
    const report = [{ type: "inbound-rtp", mediaType: "video", bytesReceived: 1 }];
    expect(extractInboundSample(report, 42)?.tMs).toBe(42); // falls back to nowMs
  });

  it("returns null when no inbound video track is present", () => {
    expect(extractInboundSample([{ type: "inbound-rtp", kind: "audio" }], 0)).toBeNull();
  });
});

describe("computeStats", () => {
  const base: InboundSample = { tMs: 0, bytesReceived: 0, packetsReceived: 0, packetsLost: 0, framesDecoded: 0 };

  it("computes bitrate, fps, and loss over the interval", () => {
    const prev = base;
    const cur: InboundSample = {
      tMs: 1000, // 1 second later
      bytesReceived: 250_000, // 2,000,000 bits/s = 2000 kbps
      packetsReceived: 300,
      packetsLost: 3,
      framesDecoded: 30,
    };
    expect(computeStats(prev, cur)).toEqual({
      bitrateKbps: 2000,
      fps: 30,
      packetLossPct: Math.round((3 / 303) * 1000) / 10, // ~1.0
    });
  });

  it("clamps negative counter deltas (reset / track swap) to zero", () => {
    const prev: InboundSample = { tMs: 0, bytesReceived: 999, packetsReceived: 50, packetsLost: 5, framesDecoded: 90 };
    const cur: InboundSample = { tMs: 1000, bytesReceived: 0, packetsReceived: 0, packetsLost: 0, framesDecoded: 0 };
    expect(computeStats(prev, cur)).toEqual({ bitrateKbps: 0, fps: 0, packetLossPct: 0 });
  });

  it("does not divide by zero on same-tick samples", () => {
    const s: InboundSample = { ...base, tMs: 500 };
    expect(() => computeStats(s, { ...s })).not.toThrow();
    expect(computeStats(s, { ...s }).bitrateKbps).toBe(0);
  });

  it("reports zero loss when no packets moved", () => {
    expect(computeStats(base, { ...base, tMs: 1000 }).packetLossPct).toBe(0);
  });
});

describe("formatStats", () => {
  it("renders a compact HUD label", () => {
    expect(formatStats({ bitrateKbps: 1850, fps: 30, packetLossPct: 0.4 })).toBe(
      "1,850 kbps · 30 fps · 0.4% loss",
    );
  });
});
