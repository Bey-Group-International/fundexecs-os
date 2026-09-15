import {
  CHUNK_MS,
  CODEC_PREFERENCE,
  RECORDING_HEIGHT,
  RECORDING_WIDTH,
  RETENTION_DAYS,
  chunkPath,
  estimatedBytes,
  extensionFor,
  formatSize,
  preferredMimeType,
  recordingNotice,
  recordingPrefix,
  retentionExpiry,
} from "@/lib/meetings/recording-policy";

describe("preferredMimeType", () => {
  it("takes VP9 when it can — around 30% smaller at the same quality", () => {
    expect(preferredMimeType(() => true)).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls back down the list", () => {
    const vp8Only = (t: string) => t === "video/webm;codecs=vp8,opus";
    expect(preferredMimeType(vp8Only)).toBe("video/webm;codecs=vp8,opus");
  });

  // Safari records MP4 and not WebM. Last, because H.264 encoding on a machine
  // already running a call is the most expensive option here.
  it("reaches MP4 only when nothing else is offered", () => {
    expect(preferredMimeType((t) => t === "video/mp4")).toBe("video/mp4");
  });

  it("says so when the browser can record nothing", () => {
    expect(preferredMimeType(() => false)).toBeNull();
  });

  // A browser that throws on a type it does not understand has answered no.
  it("treats a throwing support check as a no", () => {
    expect(preferredMimeType(() => { throw new Error("nope"); })).toBeNull();
  });

  it("only ever returns something from the preference list", () => {
    const picked = preferredMimeType(() => true);
    expect(CODEC_PREFERENCE).toContain(picked);
  });
});

describe("chunkPath", () => {
  // part-10 sorting before part-2 would reassemble the meeting in the wrong
  // order, and it would do it silently.
  it("zero-pads so a string sort is playback order", () => {
    const paths = [1, 2, 10, 100].map((i) => chunkPath("m", "r", i, "video/webm"));
    expect([...paths].sort()).toEqual(paths);
  });

  it("names the container it actually holds", () => {
    expect(chunkPath("m", "r", 0, "video/mp4").endsWith(".mp4")).toBe(true);
    expect(chunkPath("m", "r", 0, "video/webm;codecs=vp9,opus").endsWith(".webm")).toBe(true);
  });

  it("puts every part of a recording under one prefix", () => {
    const prefix = recordingPrefix("m", "r");
    expect(chunkPath("m", "r", 7, "video/webm").startsWith(prefix)).toBe(true);
  });
});

describe("extensionFor", () => {
  it("maps the containers", () => {
    expect(extensionFor("video/mp4")).toBe("mp4");
    expect(extensionFor("video/webm")).toBe("webm");
    // Anything unrecognised is stored as webm rather than as nothing.
    expect(extensionFor("application/octet-stream")).toBe("webm");
  });
});

describe("retentionExpiry", () => {
  it("is the configured number of days out", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = retentionExpiry(start);
    expect(end.getTime() - start.getTime()).toBe(RETENTION_DAYS * 86_400_000);
  });

  it("takes an override, for a deployment that wants a different floor", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(retentionExpiry(start, 1).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("estimatedBytes", () => {
  it("lands near the quoted 675 MB per hour", () => {
    const hour = estimatedBytes(3600);
    expect(hour).toBeGreaterThan(700_000_000 * 0.9);
    expect(hour).toBeLessThan(800_000_000);
  });

  it("is never negative", () => {
    expect(estimatedBytes(-10)).toBe(0);
  });
});

describe("formatSize", () => {
  it("reads like a file size", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024 * 5.5)).toBe("5.5 MB");
    expect(formatSize(1024 * 1024 * 700)).toBe("700 MB");
    expect(formatSize(1024 * 1024 * 1024 * 2)).toBe("2.0 GB");
  });
});

describe("recordingNotice", () => {
  // Several US states require every party to know. "The host knew" is not that,
  // so the notice is the same words for everyone.
  it("names who is recording", () => {
    expect(recordingNotice("recording", "Alina")).toBe("Alina is recording this meeting");
  });

  it("still says so without a name", () => {
    expect(recordingNotice("recording")).toBe("This meeting is being recorded");
    expect(recordingNotice("recording", "   ")).toBe("This meeting is being recorded");
  });

  it("covers the states either side", () => {
    expect(recordingNotice("starting")).toBe("Starting recording…");
    expect(recordingNotice("stopping")).toBe("Saving recording…");
    expect(recordingNotice("failed")).toContain("could not be saved");
  });

  it("says nothing when nothing is happening", () => {
    expect(recordingNotice("idle")).toBeNull();
  });
});

describe("the numbers themselves", () => {
  it("records 720p, not 1080p — a quarter of the pixels to composite", () => {
    expect(RECORDING_WIDTH).toBe(1280);
    expect(RECORDING_HEIGHT).toBe(720);
  });

  // This is the granularity of what survives a crash, and one request each.
  it("keeps a part well inside every request limit on the path", () => {
    const bytes = estimatedBytes(CHUNK_MS / 1000);
    expect(bytes).toBeLessThan(4_000_000);
  });
});
