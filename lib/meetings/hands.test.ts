import { handsFirst, handsUpLabel, raisedBy, type Raiser } from "@/lib/meetings/hands";

const PEOPLE: Raiser[] = [
  { id: "local", displayName: "You" },
  { id: "p1", displayName: "Nadia" },
  { id: "p2", displayName: "Sam" },
  { id: "p3", displayName: "Rivka" },
  { id: "p4", displayName: "Tomas" },
];

describe("raisedBy", () => {
  // The order a chair would take them in, which is the order they went up —
  // not the order the participant list happens to be in.
  it("keeps the order the hands went up", () => {
    const raised = new Set(["p3", "p1"]);
    expect(raisedBy(raised, PEOPLE).map((r) => r.id)).toEqual(["p3", "p1"]);
  });

  it("leaves out the viewer's own hand", () => {
    expect(raisedBy(new Set(["local", "p1"]), PEOPLE).map((r) => r.id)).toEqual(["p1"]);
  });

  // A hand belonging to somebody who has since dropped off is not a hand
  // anyone can answer, and naming them in the tooltip would be a lie.
  it("drops a hand from someone who has left", () => {
    expect(raisedBy(new Set(["gone", "p2"]), PEOPLE).map((r) => r.id)).toEqual(["p2"]);
  });
});

describe("handsUpLabel", () => {
  it("says nothing when no hand is up", () => {
    expect(handsUpLabel([])).toBe("");
  });

  it("reads as a sentence at every count", () => {
    const [, n, s, r, t] = PEOPLE;
    expect(handsUpLabel([n])).toBe("Nadia has a hand up");
    expect(handsUpLabel([n, s])).toBe("Nadia and Sam have hands up");
    expect(handsUpLabel([n, s, r])).toBe("Nadia, Sam and 1 other have hands up");
    expect(handsUpLabel([n, s, r, t])).toBe("Nadia, Sam and 2 others have hands up");
  });

  it("ignores a participant with no name to say", () => {
    expect(handsUpLabel([{ id: "p9", displayName: "  " }])).toBe("");
  });
});

describe("handsFirst", () => {
  it("lifts raised hands to the top, oldest first", () => {
    const sorted = handsFirst(PEOPLE, new Set(["p4", "p2"]));
    expect(sorted.map((p) => p.id)).toEqual(["p4", "p2", "local", "p1", "p3"]);
  });

  // Otherwise the list reshuffles under the cursor every time somebody's
  // microphone opens, and "Remove" lands on the wrong person.
  it("leaves everyone else where they were", () => {
    expect(handsFirst(PEOPLE, new Set()).map((p) => p.id)).toEqual(PEOPLE.map((p) => p.id));
  });

  it("does not mutate what it was given", () => {
    const copy = [...PEOPLE];
    handsFirst(PEOPLE, new Set(["p3"]));
    expect(PEOPLE).toEqual(copy);
  });
});
