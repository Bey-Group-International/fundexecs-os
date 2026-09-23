import {
  AUDIO_CODEC_PREFERENCE,
  CALL_AUDIO_BITRATE,
  NO_SHARED_AUDIO_NOTICE,
  canOfferComputerAudio,
  captureErrorMessage,
  estimatedCallBytes,
  isFatalCaptureFailure,
  preferredAudioMimeType,
} from "@/lib/meetings/audio-capture";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("preferredAudioMimeType", () => {
  it("prefers opus in webm", () => {
    expect(preferredAudioMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls through to what the browser will take", () => {
    expect(preferredAudioMimeType((t) => t.startsWith("audio/mp4"))).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  // A recorder that silently picked video would store an hour of still picture
  // for a phone call — the exact cost this module exists to avoid.
  it("offers only audio containers", () => {
    for (const type of AUDIO_CODEC_PREFERENCE) expect(type.startsWith("audio/")).toBe(true);
  });

  it("is null when the browser records none of them", () => {
    expect(preferredAudioMimeType(() => false)).toBeNull();
  });
});

describe("estimatedCallBytes", () => {
  // The number that justifies audio-only: an hour of call should be tens of
  // megabytes, not the ~675MB the meeting recorder's video bitrate would cost.
  it("puts an hour of call in the tens of megabytes", () => {
    const hour = estimatedCallBytes(3600);
    expect(hour).toBeGreaterThan(40_000_000);
    expect(hour).toBeLessThan(80_000_000);
  });

  it("is the audio bitrate and nothing else", () => {
    expect(estimatedCallBytes(8)).toBe(CALL_AUDIO_BITRATE);
  });

  it("does not go negative", () => {
    expect(estimatedCallBytes(-10)).toBe(0);
  });
});

describe("captureErrorMessage", () => {
  // "Permission denied" and "there is no microphone" want opposite responses,
  // and the browser's own message names neither.
  it("tells a refusal apart from an absence", () => {
    const refused = captureErrorMessage({ name: "NotAllowedError" }, "microphone");
    const missing = captureErrorMessage({ name: "NotFoundError" }, "microphone");
    expect(refused).toMatch(/refused/i);
    expect(refused).toMatch(/address bar/i);
    expect(missing).toMatch(/no microphone was found/i);
    expect(refused).not.toBe(missing);
  });

  it("says a cancelled share is not a failure of the call", () => {
    expect(captureErrorMessage({ name: "NotAllowedError" }, "computer")).toMatch(/cancelled/i);
  });

  it("blames the other application when the device is busy", () => {
    expect(captureErrorMessage({ name: "NotReadableError" }, "microphone")).toMatch(/another application/i);
  });

  it("still says something useful for an error it does not know", () => {
    expect(captureErrorMessage(new Error("boom"), "microphone")).toMatch(/could not be captured/i);
    expect(captureErrorMessage(null, "computer")).toMatch(/computer audio/i);
  });
});

describe("isFatalCaptureFailure", () => {
  // Ending a call recording because somebody cancelled the optional share
  // would throw away the thing they actually asked for.
  it("is fatal for the microphone and not for the computer", () => {
    expect(isFatalCaptureFailure("microphone")).toBe(true);
    expect(isFatalCaptureFailure("computer")).toBe(false);
  });
});

describe("canOfferComputerAudio", () => {
  it("offers it on desktop Chromium", () => {
    expect(canOfferComputerAudio({ hasDisplayMedia: true, userAgent: CHROME })).toBe(true);
  });

  // Each of these exposes getDisplayMedia and then hands back a stream with no
  // audio track, so offering the toggle would promise a capture that never
  // arrives — silence the person only discovers when they play the call back.
  it("does not offer it where the audio track never arrives", () => {
    expect(canOfferComputerAudio({ hasDisplayMedia: true, userAgent: SAFARI })).toBe(false);
    expect(canOfferComputerAudio({ hasDisplayMedia: true, userAgent: FIREFOX })).toBe(false);
    expect(canOfferComputerAudio({ hasDisplayMedia: true, userAgent: IPHONE })).toBe(false);
  });

  it("does not offer it when the browser has no such method", () => {
    expect(canOfferComputerAudio({ hasDisplayMedia: false, userAgent: CHROME })).toBe(false);
  });
});

describe("the silent-share notice", () => {
  // The common mistake, and invisible otherwise: the tab is shared with "Also
  // share tab audio" left unticked, and the far end is missing from a file
  // nobody listens to until later.
  it("says what to do about it", () => {
    expect(NO_SHARED_AUDIO_NOTICE).toMatch(/tab audio/i);
    expect(NO_SHARED_AUDIO_NOTICE).toMatch(/microphone/i);
  });
});
