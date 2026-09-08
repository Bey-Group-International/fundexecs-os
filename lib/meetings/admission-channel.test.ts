import { ADMISSION_NUDGE, admissionChannelName } from "./admission-channel";

describe("admissionChannelName", () => {
  it("is stable for the same guest in the same room", () => {
    expect(admissionChannelName("abc-defg-hi", "g1")).toBe(admissionChannelName("abc-defg-hi", "g1"));
  });

  // The reason it is per guest rather than per meeting: a shared channel would
  // have to name whose decision changed, and a guest key is enough to read that
  // guest's status from the poll endpoint.
  it("gives two guests in one room different channels", () => {
    expect(admissionChannelName("abc-defg-hi", "g1")).not.toBe(admissionChannelName("abc-defg-hi", "g2"));
  });

  it("gives one guest different channels in different rooms", () => {
    expect(admissionChannelName("room-one", "g1")).not.toBe(admissionChannelName("room-two", "g1"));
  });

  it("cannot be found without already knowing the key", () => {
    expect(admissionChannelName("abc-defg-hi", "secret-key")).toContain("secret-key");
    expect(admissionChannelName("abc-defg-hi", "secret-key")).toContain("abc-defg-hi");
  });

  // Publisher and subscriber both read this constant; a literal on either side
  // would be a silent delivery failure rather than a build error.
  it("names one event", () => {
    expect(ADMISSION_NUDGE).toBe("admission");
  });
});
