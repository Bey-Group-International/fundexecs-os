import {
  emptyLiveNotes,
  normalizeLiveNotes,
  normalizeNoteItem,
  normalizeNoteList,
  normalizeNoteText,
} from "@/lib/meetings/live-notes";

describe("normalizeNoteItem", () => {
  it("passes a plain string through, trimmed", () => {
    expect(normalizeNoteItem("  Send the deck  ")).toBe("Send the deck");
  });

  it("renders the owner/task object shape the model tends to answer with", () => {
    expect(normalizeNoteItem({ owner: "Sarah", task: "Send the deck" })).toBe("Sarah: Send the deck");
  });

  it("keeps a deadline when one is given", () => {
    expect(normalizeNoteItem({ owner: "Sarah", task: "Send the deck", due: "Friday" }))
      .toBe("Sarah: Send the deck (due Friday)");
  });

  it("renders a task with no owner without a leading colon", () => {
    expect(normalizeNoteItem({ task: "Send the deck" })).toBe("Send the deck");
  });

  it("accepts the other key names the model reaches for", () => {
    expect(normalizeNoteItem({ assignee: "Ada", action: "Draft the memo" })).toBe("Ada: Draft the memo");
    expect(normalizeNoteItem({ who: "Ada", description: "Draft the memo", deadline: "Monday" }))
      .toBe("Ada: Draft the memo (due Monday)");
  });

  it("salvages an object with no key it recognizes instead of rendering an object", () => {
    const line = normalizeNoteItem({ foo: "raise the round", bar: "by Q3" });
    expect(line).toBe("raise the round — by Q3");
    expect(line).not.toContain("object");
  });

  it("flattens a nested list", () => {
    expect(normalizeNoteItem(["Send the deck", "Book the follow-up"]))
      .toBe("Send the deck — Book the follow-up");
  });

  it("renders numbers and booleans rather than dropping them", () => {
    expect(normalizeNoteItem(3)).toBe("3");
    expect(normalizeNoteItem(true)).toBe("true");
  });

  it("gives nothing back for null, undefined or an empty object", () => {
    expect(normalizeNoteItem(null)).toBe("");
    expect(normalizeNoteItem(undefined)).toBe("");
    expect(normalizeNoteItem({})).toBe("");
  });
});

describe("normalizeNoteList", () => {
  it("coerces a mixed list to strings", () => {
    expect(normalizeNoteList(["Send the deck", { owner: "Ada", task: "Draft the memo" }]))
      .toEqual(["Send the deck", "Ada: Draft the memo"]);
  });

  it("drops empties and duplicates", () => {
    expect(normalizeNoteList(["Send the deck", "", null, "Send the deck"])).toEqual(["Send the deck"]);
  });

  it("wraps a bare value the model returned instead of a list", () => {
    expect(normalizeNoteList("Send the deck")).toEqual(["Send the deck"]);
  });

  it("treats null and an empty string as no items", () => {
    expect(normalizeNoteList(null)).toEqual([]);
    expect(normalizeNoteList("")).toEqual([]);
  });

  it("caps a runaway list", () => {
    const many = Array.from({ length: 200 }, (_, i) => `item ${i}`);
    expect(normalizeNoteList(many, 10)).toHaveLength(10);
  });
});

describe("normalizeNoteText", () => {
  it("trims a string", () => {
    expect(normalizeNoteText("  A short call.  ")).toBe("A short call.");
  });

  it("flattens an object into a line rather than rendering it", () => {
    expect(normalizeNoteText({ summary: "A short call." })).toBe("A short call.");
  });

  it("is empty for null", () => {
    expect(normalizeNoteText(null)).toBe("");
  });
});

describe("normalizeLiveNotes", () => {
  it("keeps well-formed output unchanged", () => {
    const notes = {
      key_points: ["Discussed the round"],
      action_items: ["Sarah: Send the deck"],
      decisions: ["Proceed to diligence"],
      summary: "A short call.",
    };
    expect(normalizeLiveNotes(notes)).toEqual(notes);
  });

  it("renders object action items instead of letting them reach JSX", () => {
    const notes = normalizeLiveNotes({
      key_points: [],
      action_items: [{ owner: "Sarah", task: "Send the deck", due: "Friday" }],
      decisions: [],
      summary: "",
    });
    expect(notes.action_items).toEqual(["Sarah: Send the deck (due Friday)"]);
    notes.action_items.forEach((item) => expect(typeof item).toBe("string"));
  });

  it("fills in every field the model omitted", () => {
    expect(normalizeLiveNotes({ summary: "A short call." })).toEqual({
      ...emptyLiveNotes(),
      summary: "A short call.",
    });
  });

  it("drops extra keys rather than passing them to a typed client", () => {
    expect(Object.keys(normalizeLiveNotes({ summary: "hi", sentiment: "positive" })).sort())
      .toEqual(["action_items", "decisions", "key_points", "summary"]);
  });

  it("falls back to empty notes for a non-object", () => {
    expect(normalizeLiveNotes(null)).toEqual(emptyLiveNotes());
    expect(normalizeLiveNotes("nope")).toEqual(emptyLiveNotes());
    expect(normalizeLiveNotes([1, 2])).toEqual(emptyLiveNotes());
  });
});
