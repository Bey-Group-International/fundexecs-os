import { parseActionItem, clampTitle } from "@/lib/meetings/action-items";

describe("parseActionItem", () => {
  it("reads the owner off the front", () => {
    expect(parseActionItem("Sarah: Send the deck by Friday")).toEqual({
      owner: "Sarah",
      task: "Send the deck by Friday",
      line: "Sarah: Send the deck by Friday",
    });
  });

  it("reads a full name", () => {
    expect(parseActionItem("Sarah Chen: Send the deck").owner).toBe("Sarah Chen");
  });

  it("keeps the (due …) suffix the normalizer adds", () => {
    expect(parseActionItem("Sarah: Send the deck (due Friday)").task).toBe("Send the deck (due Friday)");
  });

  it("leaves an item with no prefix alone", () => {
    const parsed = parseActionItem("Send the deck by Friday");
    expect(parsed.owner).toBeNull();
    expect(parsed.task).toBe("Send the deck by Friday");
  });

  // The prefix has to look like a name. These are the ways it does not.
  it.each([
    ["Action: Send the deck", "a label, not a person"],
    ["Follow-up: Send the deck", "a label, not a person"],
    ["Team: Send the deck", "not one person"],
    ["Unassigned: Send the deck", "explicitly nobody"],
    ["Sarah and Mike: Send the deck", "two people"],
    ["Sarah, Mike: Send the deck", "two people"],
    ["Sarah & Mike: Send the deck", "two people"],
    ["We agreed the round was oversubscribed, so: send the deck", "a clause"],
    ["Decide whether to proceed. If yes: send the deck", "a sentence"],
    ["A very long prefix that goes on well past anything anyone is called: do it", "too long"],
  ])("does not read an owner out of %j (%s)", (line) => {
    expect(parseActionItem(line).owner).toBeNull();
  });

  it("keeps the whole line when it declines to split", () => {
    const line = "Action: Send the deck";
    expect(parseActionItem(line).task).toBe(line);
  });

  it("is not fooled by a trailing colon", () => {
    expect(parseActionItem("Sarah:").owner).toBeNull();
  });

  it("survives empty input", () => {
    expect(parseActionItem("")).toEqual({ owner: null, task: "", line: "" });
  });

  it("collapses the whitespace a model's line breaks leave behind", () => {
    expect(parseActionItem("Sarah:   Send   the deck").task).toBe("Send the deck");
  });
});

describe("clampTitle", () => {
  it("leaves a short title alone", () => {
    expect(clampTitle("Send the deck")).toBe("Send the deck");
  });

  it("cuts on a word boundary rather than mid-word", () => {
    const long = "Send the updated cap table to the investors before the board meeting on Thursday afternoon";
    const out = clampTitle(long, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
    // The giveaway of the old slice: a half word at the end.
    expect(long).toContain(out.slice(0, -1).trim());
  });

  it("does not collapse to nothing on one enormous word", () => {
    const out = clampTitle("a".repeat(200), 40);
    expect(out.length).toBe(40);
  });

  it("drops the punctuation a cut lands on", () => {
    expect(clampTitle("Send the deck, and the model, to everyone", 20)).not.toContain(",…");
  });
});
