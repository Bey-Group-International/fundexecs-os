/**
 * Reactions: what one is, and where the room can see it.
 *
 * Two defects underneath these. Nothing on the receiving side ever checked
 * that an arriving reaction was one of the six the picker offers, and the only
 * place a reaction was drawn was an overlay on the sender's tile — which is
 * off-screen in speaker layout and below the fold in a large grid, an argument
 * hands.ts had already written down and acted on for raised hands.
 */
import {
  REACTIONS,
  REACTION_VISIBLE_MS,
  activeReactions,
  normalizeReaction,
  reactionLabel,
  withoutReaction,
  type ReactionState,
} from "@/lib/meetings/reactions";

const at = (emoji: string, t: number): ReactionState => ({ emoji, at: t });

const PEOPLE = [
  { id: "local", displayName: "Alina" },
  { id: "p2", displayName: "Rae Okafor" },
  { id: "p3", displayName: "Sam" },
];

// ── The bound ───────────────────────────────────────────────────────────────

describe("normalizeReaction", () => {
  it("accepts every emoji the picker offers", () => {
    for (const emoji of REACTIONS) expect(normalizeReaction(emoji)).toBe(emoji);
  });

  it("tolerates whitespace around one", () => {
    expect(normalizeReaction("  👍 ")).toBe("👍");
  });

  // The defect: the tile drew whatever arrived, at text-4xl, across the
  // picture. The picker is not a check — nothing consulted it on the way in.
  it("refuses anything that is not one of them", () => {
    expect(normalizeReaction("🦆")).toBe("");
    expect(normalizeReaction("x".repeat(500))).toBe("");
    expect(normalizeReaction("NOT A REACTION")).toBe("");
    expect(normalizeReaction("<img src=x>")).toBe("");
  });

  it("refuses a non-string or an empty one", () => {
    expect(normalizeReaction(undefined)).toBe("");
    expect(normalizeReaction(null)).toBe("");
    expect(normalizeReaction(42)).toBe("");
    expect(normalizeReaction("")).toBe("");
    expect(normalizeReaction("   ")).toBe("");
  });

  // ❤️ is two code points (U+2764 U+FE0F). A bound written in string length or
  // a naive single-character check would drop it.
  it("keeps a multi-code-point emoji whole", () => {
    expect(REACTIONS).toContain("❤️");
    expect(normalizeReaction("❤️")).toBe("❤️");
    // ...and does not accept the bare heart without its variation selector,
    // which is a different glyph the picker never offers.
    expect(normalizeReaction("❤")).toBe("");
  });

  it("has a visible window worth reading", () => {
    expect(REACTION_VISIBLE_MS).toBeGreaterThan(0);
  });
});

// ── Where the room can see it ───────────────────────────────────────────────

describe("activeReactions", () => {
  it("attaches the name, so a reaction can be read away from the tile", () => {
    const out = activeReactions({ p2: at("👍", 10) }, PEOPLE);
    expect(out).toEqual([{ id: "p2", displayName: "Rae Okafor", emoji: "👍" }]);
  });

  // Includes the sender's own, unlike raisedBy for hands: you know your hand is
  // up because the button is lit, but a reaction you fired has nothing to
  // confirm it except the tile that may be scrolled out of the strip.
  it("includes your own reaction", () => {
    const out = activeReactions({ local: at("🎉", 5) }, PEOPLE);
    expect(out.map((r) => r.id)).toEqual(["local"]);
  });

  it("orders by when it landed, newest last", () => {
    const out = activeReactions({ p3: at("👏", 30), local: at("👍", 10), p2: at("😂", 20) }, PEOPLE);
    expect(out.map((r) => r.id)).toEqual(["local", "p2", "p3"]);
  });

  // A record keeps a key where it first appeared when its value is replaced,
  // so key order is the wrong clock: somebody reacting twice would stay put
  // while everyone who reacted after them moved past.
  it("moves somebody who reacts again to the end", () => {
    const first = { local: at("👍", 10), p2: at("😂", 20) };
    const second = { ...first, local: at("🎉", 30) };
    expect(activeReactions(second, PEOPLE).map((r) => r.id)).toEqual(["p2", "local"]);
  });

  it("orders a tie the same way on every screen", () => {
    const out = activeReactions({ p3: at("👏", 7), p2: at("😂", 7) }, PEOPLE);
    expect(out.map((r) => r.id)).toEqual(["p2", "p3"]);
  });

  it("drops a reaction from somebody who has left", () => {
    expect(activeReactions({ gone: at("👍", 10) }, PEOPLE)).toEqual([]);
  });

  it("drops an empty or missing emoji rather than rendering a blank row", () => {
    expect(activeReactions({ p2: at("", 10) }, PEOPLE)).toEqual([]);
    expect(activeReactions({ p2: undefined as unknown as ReactionState }, PEOPLE)).toEqual([]);
  });

  it("is empty when nobody is reacting", () => {
    expect(activeReactions({}, PEOPLE)).toEqual([]);
  });
});

// ── What a screen reader gets ───────────────────────────────────────────────

describe("reactionLabel", () => {
  // The tile overlay is a bare emoji with no text, so there was nothing to
  // announce and reactions did not exist for anyone not looking at the picture.
  it("reads as a sentence", () => {
    expect(reactionLabel({ id: "p2", displayName: "Rae Okafor", emoji: "👍" }))
      .toBe("Rae Okafor reacted 👍");
  });

  it("never announces a nameless reaction", () => {
    expect(reactionLabel({ id: "p2", displayName: "   ", emoji: "🎉" })).toBe("Someone reacted 🎉");
  });
});

// ── Taking one off again ────────────────────────────────────────────────────
//
// A peer leaving dropped their reaction and left the pending timeout running,
// so three seconds later an orphan fired against somebody no longer in the
// room — and the updater it fired allocated a fresh record whether or not
// there was anything to remove, re-rendering the whole meeting for nothing.

describe("withoutReaction", () => {
  it("removes the one asked for and leaves the rest", () => {
    const before = { local: at("👍", 10), p2: at("😂", 20) };
    expect(withoutReaction(before, "local")).toEqual({ p2: at("😂", 20) });
  });

  // The identity is the assertion: React bails out of a re-render when the
  // state is the same object, and allocating a new one is what made an expiry
  // for an absent person cost a full render of the room.
  it("returns the very same record when there is nothing to remove", () => {
    const before = { p2: at("😂", 20) };
    expect(withoutReaction(before, "gone")).toBe(before);
    expect(withoutReaction({}, "anyone")).toEqual({});
  });

  it("does not mutate the record it was handed", () => {
    const before = { p2: at("😂", 20) };
    withoutReaction(before, "p2");
    expect(before).toEqual({ p2: at("😂", 20) });
  });
});
