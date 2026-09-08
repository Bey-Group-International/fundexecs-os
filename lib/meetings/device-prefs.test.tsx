// Storage is the interesting part here, not the getter and setter. Every
// browser this runs in can refuse it — Safari in private mode throws on access
// rather than returning null — and a device picker must not take a call down
// with it.

import { DEVICE_PREF_KEYS } from "./devices";
import { rememberDevice, rememberedDevice } from "./device-prefs";

describe("device preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers a choice and reads it back", () => {
    rememberDevice("audioinput", "mic-7");
    expect(rememberedDevice("audioinput")).toBe("mic-7");
    expect(window.localStorage.getItem(DEVICE_PREF_KEYS.audioinput)).toBe("mic-7");
  });

  it("has nothing to say before a choice is made", () => {
    expect(rememberedDevice("videoinput")).toBeNull();
  });

  it("keeps the kinds apart", () => {
    rememberDevice("videoinput", "cam-1");
    expect(rememberedDevice("audioinput")).toBeNull();
    expect(rememberedDevice("audiooutput")).toBeNull();
  });

  it("does not store 'system default' as though it were a device", () => {
    rememberDevice("videoinput", "cam-1");
    // A blank id is what an automatic fallback uses. Writing it over a real
    // preference would mean unplugging a headset once forgot it forever.
    rememberDevice("videoinput", "");
    expect(rememberedDevice("videoinput")).toBe("cam-1");
  });

  it("reads an empty stored value as no preference", () => {
    window.localStorage.setItem(DEVICE_PREF_KEYS.audiooutput, "");
    expect(rememberedDevice("audiooutput")).toBeNull();
  });

  it("survives storage that refuses to answer", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(rememberedDevice("audioinput")).toBeNull();
    expect(() => rememberDevice("audioinput", "mic-7")).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
