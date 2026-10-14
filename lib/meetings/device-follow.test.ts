import { followDecision, followNotice, newlyPluggedDevices } from "./device-follow";
import type { Device } from "./devices";

const dev = (over: Partial<Device>): Device => ({ deviceId: "id", kind: "audioinput", label: "Mic", groupId: "g", ...over });

const laptop: Device[] = [
  dev({ deviceId: "default", label: "Default - Built-in Microphone", groupId: "builtin" }),
  dev({ deviceId: "builtin-mic", label: "Built-in Microphone", groupId: "builtin" }),
  dev({ deviceId: "default-out", kind: "audiooutput", label: "Default - Built-in Speakers", groupId: "builtin" }),
  dev({ deviceId: "builtin-out", kind: "audiooutput", label: "Built-in Speakers", groupId: "builtin" }),
  dev({ deviceId: "cam", kind: "videoinput", label: "FaceTime HD", groupId: "cam" }),
];
const headsetMic = dev({ deviceId: "jabra-in", label: "Jabra Evolve2", groupId: "jabra" });
const headsetOut = dev({ deviceId: "jabra-out", kind: "audiooutput", label: "Jabra Evolve2", groupId: "jabra" });

describe("newlyPluggedDevices", () => {
  it("finds the devices that appeared", () => {
    const added = newlyPluggedDevices(laptop, [...laptop, headsetMic, headsetOut]);
    expect(added.map((d) => d.deviceId)).toEqual(["jabra-in", "jabra-out"]);
  });

  // A default-device change re-fires devicechange with the same list: the
  // alias now names a different device, and nothing was plugged in.
  it("ignores the default aliases and unlabelled entries", () => {
    const after = [
      ...laptop,
      dev({ deviceId: "default", label: "Default - Jabra Evolve2", groupId: "jabra" }),
      dev({ deviceId: "communications", label: "Communications - Jabra", groupId: "jabra" }),
      dev({ deviceId: "mystery", label: "" }),
    ];
    expect(newlyPluggedDevices(laptop, after)).toEqual([]);
  });

  it("reports nothing when nothing changed, or a device was removed", () => {
    expect(newlyPluggedDevices(laptop, laptop)).toEqual([]);
    expect(newlyPluggedDevices(laptop, laptop.slice(0, 2))).toEqual([]);
  });
});

describe("followDecision", () => {
  it("moves both sides to a headset", () => {
    const d = followDecision({ added: [headsetMic, headsetOut], currentMicId: "builtin-mic", currentSpeakerId: "" })!;
    expect(d).toEqual({ micId: "jabra-in", speakerId: "jabra-out", label: "Jabra Evolve2" });
    expect(followNotice(d)).toBe("Your microphone and speaker moved to Jabra Evolve2.");
  });

  it("moves only the microphone for a microphone alone", () => {
    const d = followDecision({ added: [dev({ deviceId: "yeti", label: "Yeti" })], currentMicId: "builtin-mic", currentSpeakerId: "" })!;
    expect(d).toEqual({ micId: "yeti", speakerId: null, label: "Yeti" });
    expect(followNotice(d)).toBe("Your microphone moved to Yeti.");
  });

  it("moves only the output for a speaker alone", () => {
    const d = followDecision({ added: [headsetOut], currentMicId: "builtin-mic", currentSpeakerId: "builtin-out" })!;
    expect(d).toEqual({ micId: null, speakerId: "jabra-out", label: "Jabra Evolve2" });
    expect(followNotice(d)).toBe("Call audio moved to Jabra Evolve2.");
  });

  it("is not a switch when the new device is already in use", () => {
    expect(followDecision({ added: [headsetMic], currentMicId: "jabra-in", currentSpeakerId: "" })).toBeNull();
    expect(followDecision({ added: [], currentMicId: "builtin-mic", currentSpeakerId: "" })).toBeNull();
  });

  // A headset's two halves share a group; a stray speaker from somewhere else
  // must not be paired with the headset's microphone.
  it("pairs the speaker with the microphone's own group when it can", () => {
    const tv = dev({ deviceId: "tv", kind: "audiooutput", label: "Living room TV", groupId: "tv" });
    const d = followDecision({ added: [tv, headsetMic, headsetOut], currentMicId: "builtin-mic", currentSpeakerId: "" })!;
    expect(d.speakerId).toBe("jabra-out");
  });
});
