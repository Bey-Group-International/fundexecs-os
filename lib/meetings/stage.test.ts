// Who the room is looking at.
//
// These rules existed only inside the recording composer. The live room had
// none of them, which is why screen sharing did not really work: the share was
// tracked, broadcast, and drawn as one grid cell the size of a face.

import { effectiveLayout, layoutIsForced, screenSharerId, stageFocusId } from "./stage";

const peer = (sharing: boolean) => ({ camOn: true, paused: false, sharing });

describe("who is sharing", () => {
  it("is nobody when nobody is", () => {
    expect(screenSharerId({
      localIsSharing: false, localId: "local",
      peers: new Map([["a", peer(false)], ["b", peer(false)]]),
    })).toBeNull();
  });

  it("finds the peer who says they are", () => {
    expect(screenSharerId({
      localIsSharing: false, localId: "local",
      peers: new Map([["a", peer(false)], ["b", peer(true)]]),
    })).toBe("b");
  });

  // Our own share needs no round trip to be true.
  it("prefers our own share over anyone else's", () => {
    expect(screenSharerId({
      localIsSharing: true, localId: "local",
      peers: new Map([["a", peer(true)]]),
    })).toBe("local");
  });

  // Two at once is an argument the room is having, not one the layout has to
  // settle. Join order, the same rule the recording already follows.
  it("takes the first of two rather than arbitrating", () => {
    expect(screenSharerId({
      localIsSharing: false, localId: "local",
      peers: new Map([["a", peer(true)], ["b", peer(true)]]),
    })).toBe("a");
  });

  it("treats a peer who has said nothing as not sharing", () => {
    expect(screenSharerId({
      localIsSharing: false, localId: "local",
      peers: new Map([["a", {}]]),
    })).toBeNull();
  });
});

describe("what the stage shows", () => {
  it("follows the speaker when nobody is sharing", () => {
    expect(stageFocusId({ screenSharerId: null, activeSpeakerId: "a" })).toBe("a");
  });

  // The defect: the spotlight was the audio meter and nothing else, so a
  // presenter who paused to take a question lost the big tile to the person
  // asking — mid-slide.
  it("gives a share the stage over whoever is talking", () => {
    expect(stageFocusId({ screenSharerId: "a", activeSpeakerId: "b" })).toBe("a");
  });

  it("has nothing to focus when the room is quiet and nothing is shared", () => {
    expect(stageFocusId({ screenSharerId: null, activeSpeakerId: null })).toBeNull();
  });
});

describe("the layout a share forces", () => {
  // An even grid cannot show a screen: at six people it is about a sixth of
  // the area, and read by nobody.
  it("moves a grid into speaker view for the length of a share", () => {
    expect(effectiveLayout("grid", "a")).toBe("speaker");
  });

  it("leaves speaker view alone", () => {
    expect(effectiveLayout("speaker", "a")).toBe("speaker");
  });

  // Remembered underneath, so the share ending puts them back where they were
  // rather than making them choose again.
  it("returns the chosen layout once the share ends", () => {
    expect(effectiveLayout("grid", null)).toBe("grid");
    expect(effectiveLayout("speaker", null)).toBe("speaker");
  });

  it("says when the choice is being overridden, and only then", () => {
    expect(layoutIsForced("grid", "a")).toBe(true);
    expect(layoutIsForced("speaker", "a")).toBe(false);
    expect(layoutIsForced("grid", null)).toBe(false);
  });
});
