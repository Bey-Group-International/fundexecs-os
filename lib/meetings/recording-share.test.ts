import {
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  cleanDays,
  cleanLabel,
  cleanWindow,
  expiryLabel,
  formatClock,
  parseClock,
  shareState,
  agoLabel,
  clipCues,
  clipFilename,
  clipStatusLabel,
  deviceLabel,
  viewSummary,
  type ShareView,
} from "./recording-share";

describe("shareState", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("is revoked before it is expired", () => {
    expect(shareState({ expires_at: "2026-11-01T00:00:00Z", revoked_at: "2026-10-30T00:00:00Z" }, now)).toBe("revoked");
  });
  it("is expired at or after its expiry", () => {
    expect(shareState({ expires_at: "2026-11-06T12:00:00Z", revoked_at: null }, now)).toBe("expired");
  });
  it("is active before it", () => {
    expect(shareState({ expires_at: "2026-11-07T00:00:00Z", revoked_at: null }, now)).toBe("active");
  });
});

describe("cleanWindow", () => {
  it("keeps a sensible window", () => {
    expect(cleanWindow(10_000, 40_000, 50_000)).toEqual({ startMs: 10_000, endMs: 40_000 });
  });
  it("clamps the end to the recording", () => {
    expect(cleanWindow(10_000, 90_000, 50_000)).toEqual({ startMs: 10_000, endMs: 50_000 });
  });
  it("refuses a start past the end of the recording", () => {
    expect(cleanWindow(60_000, 70_000, 50_000)).toBeNull();
  });
  it("stretches a too-short window, moving back at the end", () => {
    expect(cleanWindow(1000, 2000, 50_000)).toEqual({ startMs: 1000, endMs: 1000 + MIN_CLIP_MS });
    expect(cleanWindow(48_000, 49_000, 50_000)).toEqual({ startMs: 50_000 - MIN_CLIP_MS, endMs: 50_000 });
  });
  it("caps a window at an hour", () => {
    const w = cleanWindow(0, 5 * MAX_CLIP_MS, 10 * MAX_CLIP_MS)!;
    expect(w.endMs! - w.startMs).toBe(MAX_CLIP_MS);
  });
  it("fills a missing end", () => {
    expect(cleanWindow(0, null, 30_000)).toEqual({ startMs: 0, endMs: 30_000 });
  });
  it("refuses a non-numeric end", () => {
    expect(cleanWindow(0, "soon", 30_000)).toBeNull();
  });
});

describe("cleanLabel and cleanDays", () => {
  it("cleans a label to one capped line", () => {
    expect(cleanLabel("  Pricing\n\n talk ")).toBe("Pricing talk");
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel(42)).toBeNull();
    expect(cleanLabel("x".repeat(500))!.length).toBe(120);
  });
  it("accepts only the offered expiries", () => {
    expect(cleanDays(30)).toBe(30);
    expect(cleanDays("90")).toBe(90);
    expect(cleanDays(365)).toBe(7);
  });
});

describe("clipCues", () => {
  const started = "2026-11-06T10:00:00.000Z";
  const at = (s: number) => new Date(Date.parse(started) + s * 1000).toISOString();
  const rows = [
    { speaker: "Ann", text: "Before the clip.", ts: at(55) },
    { speaker: "Ann", text: "Inside, first.", ts: at(61) },
    { speaker: "Ann", text: "Inside, second.", ts: at(70) },
    { speaker: "Bob", text: "Inside too.", ts: at(80) },
    { speaker: "Bob", text: "After the clip.", ts: at(95) },
  ];
  it("keeps only lines said inside the window, even within one turn", () => {
    const cues = clipCues(rows, started, { startMs: 60_000, endMs: 90_000 }, 60_000);
    expect(cues.map((c) => c.paragraphs)).toEqual([["Inside, first.", "Inside, second."], ["Inside too."]]);
    const text = cues.flatMap((c) => c.paragraphs).join(" ");
    expect(text).not.toContain("Before");
    expect(text).not.toContain("After");
  });
  it("puts lines on the clip's clock", () => {
    // The clip's file starts at 58s (a keyframe before the asked-for 60s).
    const cues = clipCues(rows, started, { startMs: 60_000, endMs: 90_000 }, 58_000);
    expect(cues.map((c) => c.atMs)).toEqual([3000, 22_000]);
  });
  it("is empty without a usable recording start", () => {
    expect(clipCues(rows, "not a date", { startMs: 0, endMs: null }, 0)).toEqual([]);
  });
});

describe("deviceLabel", () => {
  it("names browser and system coarsely", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe(
      "Chrome on macOS",
    );
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(
      "Safari on iPhone",
    );
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe(
      "Edge on Windows",
    );
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Linux");
  });
  it("calls out link unfurlers, and copes with nothing", () => {
    expect(deviceLabel("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe("Link preview");
    expect(deviceLabel("")).toBe("Unknown device");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});

describe("viewSummary", () => {
  const v = (kind: ShareView["kind"], viewer: string, device = "Chrome on macOS"): ShareView => ({
    kind,
    viewer,
    device,
    createdAt: "2026-11-06T10:00:00Z",
  });
  it("counts opens, distinct viewers and downloads, leaving out link previews", () => {
    const s = viewSummary([v("open", "a"), v("open", "a"), v("open", "b"), v("download", "a"), v("open", "c", "Link preview")]);
    expect(s).toMatchObject({ opens: 4, viewers: 2, downloads: 1 });
    expect(s.text).toBe("4 opens · 2 viewers · 1 download");
  });
  it("reads well for nothing", () => {
    expect(viewSummary([]).text).toBe("0 opens · 0 viewers");
  });
});

describe("small labels", () => {
  it("describes the clip's preparation", () => {
    expect(clipStatusLabel("ready")).toBe("Ready");
    expect(clipStatusLabel("failed")).toBe("Couldn't be made");
    expect(clipStatusLabel("processing")).toBe("Preparing…");
    expect(clipStatusLabel(undefined)).toBe("Preparing…");
  });
  it("says how long ago", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(agoLabel("2026-11-06T11:59:40Z", now)).toBe("just now");
    expect(agoLabel("2026-11-06T11:15:00Z", now)).toBe("45 min ago");
    expect(agoLabel("2026-11-06T09:00:00Z", now)).toBe("3 hours ago");
    expect(agoLabel("2026-11-04T12:00:00Z", now)).toBe("2 days ago");
  });
  it("names a downloaded clip by its date, never its title", () => {
    expect(clipFilename("2026-11-06T10:00:00Z", "video/webm;codecs=vp9")).toBe("meeting-clip-2026-11-06.webm");
    expect(clipFilename("bad", "audio/webm")).toBe("call-clip-recording.webm");
  });
});

describe("expiryLabel", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("counts days, then hours", () => {
    expect(expiryLabel({ expires_at: "2026-11-12T12:00:00Z", revoked_at: null }, now)).toBe("Expires in 6 days");
    expect(expiryLabel({ expires_at: "2026-11-06T15:00:00Z", revoked_at: null }, now)).toBe("Expires in 3 hours");
    expect(expiryLabel({ expires_at: "2026-11-06T12:30:00Z", revoked_at: null }, now)).toBe("Expires in 1 hour");
  });
  it("says expired and revoked", () => {
    expect(expiryLabel({ expires_at: "2026-11-01T00:00:00Z", revoked_at: null }, now)).toBe("Expired");
    expect(expiryLabel({ expires_at: "2026-12-01T00:00:00Z", revoked_at: "2026-11-02T00:00:00Z" }, now)).toBe("Revoked");
  });
});

describe("clock", () => {
  it("parses and formats", () => {
    expect(parseClock("2:10")).toBe(130_000);
    expect(parseClock("1:02:03")).toBe(3_723_000);
    expect(parseClock("45")).toBe(45_000);
    expect(parseClock("2:75")).toBeNull();
    expect(parseClock("soon")).toBeNull();
    expect(formatClock(130_000)).toBe("2:10");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(-5)).toBe("0:00");
  });
});
