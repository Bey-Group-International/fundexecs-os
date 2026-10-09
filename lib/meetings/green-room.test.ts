import type { ReadinessProblem } from "./devices";
import { browserFamily, deviceSummary, leadProblem, problemGuide, shortDeviceName, waitedLabel } from "./green-room";

const p = (kind: ReadinessProblem["kind"]): ReadinessProblem => ({ kind, message: kind });

describe("browserFamily", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0", "edge"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0 Safari/537.36", "chrome"],
    ["Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/128.0 Mobile/15E148 Safari/604.1", "ios-other"],
    ["Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/128.0 Mobile/15E148 Safari/605.1.15", "ios-other"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1", "ios-safari"],
    ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1", "ios-safari"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", "safari"],
    ["Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/129.0", "firefox"],
    ["", "other"],
  ])("reads %s", (ua, family) => {
    expect(browserFamily(ua)).toBe(family);
  });

  it("tells an iPad on the desktop site from a Mac by its touch points", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
    expect(browserFamily(ua, 5)).toBe("ios-safari");
    expect(browserFamily(ua, 0)).toBe("safari");
  });
});

describe("leadProblem", () => {
  it("puts a blocked microphone ahead of everything", () => {
    expect(leadProblem([p("camera_busy"), p("mic_blocked"), p("no_camera")])?.kind).toBe("mic_blocked");
  });

  it("leaves a quiet mic or a missing camera beside the button", () => {
    expect(leadProblem([p("mic_silent"), p("no_camera"), p("no_mic")])).toBeNull();
  });
});

describe("problemGuide", () => {
  it("gives the steps for the browser in use, ending in the retry", () => {
    const chrome = problemGuide(p("camera_blocked"), "chrome");
    expect(chrome.title).toBe("Your camera is blocked");
    expect(chrome.steps.join(" ")).toMatch(/address bar/);
    expect(chrome.steps.at(-1)).toMatch(/try again/i);

    const safari = problemGuide(p("mic_blocked"), "safari");
    expect(safari.steps.join(" ")).toMatch(/Settings for This Website/);
    expect(safari.steps.join(" ")).toMatch(/Microphone to Allow/);
  });

  it("gives an iPhone the aA menu and the Settings app, never a menu bar", () => {
    const ios = problemGuide(p("camera_blocked"), "ios-safari");
    expect(ios.steps.join(" ")).toMatch(/"aA"/);
    expect(ios.steps.join(" ")).toMatch(/Settings app/);
    expect(ios.steps.join(" ")).not.toMatch(/menu bar/);
    const other = problemGuide(p("mic_blocked"), "ios-other");
    expect(other.steps.join(" ")).toMatch(/Settings app/);
    expect(other.steps.join(" ")).not.toMatch(/address bar/);
  });

  it("tells a busy device apart from a blocked one", () => {
    expect(problemGuide(p("mic_busy"), "chrome").title).toBe("Another app is using your microphone");
  });
});

describe("device names", () => {
  it("drops the USB ids and Chrome's Default prefix", () => {
    expect(shortDeviceName("Logitech BRIO (046d:085e)")).toBe("Logitech BRIO");
    expect(shortDeviceName("Default - MacBook Pro Microphone")).toBe("MacBook Pro Microphone");
    expect(shortDeviceName(undefined)).toBe("");
  });

  it("summarises the camera and microphone in one line", () => {
    const devices = [
      { deviceId: "c", kind: "videoinput" as const, label: "Logitech BRIO (046d:085e)", groupId: "1" },
      { deviceId: "m", kind: "audioinput" as const, label: "Default - Yeti", groupId: "2" },
    ];
    expect(deviceSummary(devices, { cameraId: "c", micId: "m", cameraEnabled: true })).toBe("Logitech BRIO · Yeti");
    expect(deviceSummary(devices, { cameraId: "c", micId: "m", cameraEnabled: false })).toBe("Camera off · Yeti");
    expect(deviceSummary([], { cameraId: "", micId: "", cameraEnabled: true })).toBe("No camera · No microphone");
  });
});

describe("waitedLabel", () => {
  it("counts seconds, then minutes", () => {
    expect(waitedLabel(0)).toBe("0:00");
    expect(waitedLabel(65_000)).toBe("1:05");
    expect(waitedLabel(12 * 60_000)).toBe("12 min");
  });
});
