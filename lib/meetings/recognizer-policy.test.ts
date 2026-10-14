import { RECOGNIZER_SKIPPED_NOTICE, isMobileUserAgent, recognizerSkipReason } from "./recognizer-policy";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

describe("isMobileUserAgent", () => {
  it("recognises phones and tablets", () => {
    expect(isMobileUserAgent(IPHONE)).toBe(true);
    expect(isMobileUserAgent(ANDROID)).toBe(true);
  });

  // iPadOS asks for the desktop site and reports a Macintosh; the touch
  // points are what give it away.
  it("tells an iPad in desktop mode from a Mac", () => {
    expect(isMobileUserAgent(IPAD_DESKTOP_UA, 5)).toBe(true);
    expect(isMobileUserAgent(IPAD_DESKTOP_UA, 0)).toBe(false);
  });

  it("leaves laptops and desktops alone", () => {
    expect(isMobileUserAgent(MAC_CHROME)).toBe(false);
    expect(isMobileUserAgent(WINDOWS_EDGE)).toBe(false);
    expect(isMobileUserAgent(null)).toBe(false);
  });
});

describe("recognizerSkipReason", () => {
  // A second raw capture of the same microphone beside the call, on the
  // device least able to afford it.
  it("skips a phone whose engine captures the default microphone itself", () => {
    expect(recognizerSkipReason({ mobile: true, followsTrack: false })).toMatch(/second microphone capture/);
  });

  it("runs a phone whose engine follows the call's track", () => {
    expect(recognizerSkipReason({ mobile: true, followsTrack: true })).toBeNull();
  });

  // Desktop is unchanged: the "default microphone" notice covers the engine
  // that ignores the track there.
  it("runs every desktop engine", () => {
    expect(recognizerSkipReason({ mobile: false, followsTrack: false })).toBeNull();
    expect(recognizerSkipReason({ mobile: false, followsTrack: true })).toBeNull();
  });

  it("tells the member what still works and what to do", () => {
    expect(RECOGNIZER_SKIPPED_NOTICE).toMatch(/still be heard/);
    expect(RECOGNIZER_SKIPPED_NOTICE).toMatch(/Join from a computer/);
  });
});
