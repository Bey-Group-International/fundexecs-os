import {
  DEFAULT_NOTETAKER,
  applyGlossary,
  bookmarksForModel,
  canSeeLiveNotes,
  cleanBookmarkLabel,
  cleanNotes,
  cleanTerm,
  consentNotice,
  glossaryForModel,
  hostNotesForModel,
  liveNotesDue,
  mergeFragments,
  offsetClock,
  patchNotetaker,
  readNotetaker,
  transcriptAsText,
  transcriptFileName,
} from "./notetaker";

describe("settings", () => {
  it("reads whatever is stored, defaulting what it cannot read", () => {
    expect(readNotetaker(null)).toEqual(DEFAULT_NOTETAKER);
    expect(readNotetaker({ paused: "yes", notesVisibility: "nobody", lang: "<script>" })).toEqual(DEFAULT_NOTETAKER);
    expect(readNotetaker({ paused: true, notesVisibility: "host", lang: "es-ES" })).toEqual({ paused: true, notesVisibility: "host", lang: "es-ES" });
  });
  it("applies a valid patch and refuses an invalid or empty one", () => {
    expect(patchNotetaker(DEFAULT_NOTETAKER, { paused: true })).toEqual({ ...DEFAULT_NOTETAKER, paused: true });
    expect(patchNotetaker(DEFAULT_NOTETAKER, { lang: "fr-FR", notesVisibility: "host" })).toEqual({ paused: false, notesVisibility: "host", lang: "fr-FR" });
    expect(patchNotetaker({ ...DEFAULT_NOTETAKER, lang: "fr-FR" }, { lang: null })!.lang).toBeNull();
    expect(patchNotetaker(DEFAULT_NOTETAKER, { paused: "true" })).toBeNull();
    expect(patchNotetaker(DEFAULT_NOTETAKER, { lang: "not a tag" })).toBeNull();
    expect(patchNotetaker(DEFAULT_NOTETAKER, {})).toBeNull();
    expect(patchNotetaker(DEFAULT_NOTETAKER, "paused")).toBeNull();
  });
  it("lets the host always see the notes, others only when shared", () => {
    expect(canSeeLiveNotes({ ...DEFAULT_NOTETAKER, notesVisibility: "host" }, true)).toBe(true);
    expect(canSeeLiveNotes({ ...DEFAULT_NOTETAKER, notesVisibility: "host" }, false)).toBe(false);
    expect(canSeeLiveNotes(DEFAULT_NOTETAKER, false)).toBe(true);
  });
  it("says plainly whether the meeting is being noted", () => {
    expect(consentNotice(DEFAULT_NOTETAKER)).toMatch(/notetaker is on/);
    expect(consentNotice({ ...DEFAULT_NOTETAKER, paused: true })).toMatch(/paused/);
  });
});

describe("glossary", () => {
  it("restores the firm's spelling, case and spacing", () => {
    const terms = ["Dunbar Capital", "LPAC", "Kearny"];
    expect(applyGlossary("we spoke to dunbar capital about the l p a c", terms)).toBe("we spoke to Dunbar Capital about the LPAC");
    expect(applyGlossary("the L.P.A.C. meets friday", terms)).toBe("the LPAC meets friday");
    expect(applyGlossary("Dunbar-capital and kearny", terms)).toBe("Dunbar Capital and Kearny");
  });
  it("does not change parts of other words", () => {
    expect(applyGlossary("kearnys and lpacs", ["Kearny", "LPAC"])).toBe("kearnys and lpacs");
  });
  it("prefers the longest term", () => {
    expect(applyGlossary("dunbar capital partners", ["Dunbar", "Dunbar Capital Partners"])).toBe("Dunbar Capital Partners");
  });
  it("leaves text alone with no terms", () => {
    expect(applyGlossary("hello", [])).toBe("hello");
  });
  it("cleans terms and tells the model", () => {
    expect(cleanTerm("  Dunbar\n Capital ")).toBe("Dunbar Capital");
    expect(cleanTerm("x")).toBeNull();
    expect(cleanTerm("x".repeat(81))).toBeNull();
    expect(glossaryForModel(["LPAC", "Dunbar"])).toBe("Names and terms this firm uses (spell them exactly so): LPAC; Dunbar");
    expect(glossaryForModel([])).toBe("");
  });
});

describe("bookmarks and notes", () => {
  it("places bookmarks in the meeting, in order", () => {
    const text = bookmarksForModel(
      [
        { id: "b", at: "2026-11-06T10:12:30Z", label: "Pricing agreed", by: "Ana" },
        { id: "a", at: "2026-11-06T10:02:00Z", label: null },
      ],
      "2026-11-06T10:00:00Z",
    );
    expect(text.split("\n").slice(1)).toEqual(["- 2:00: flagged as important", "- 12:30 (Ana): Pricing agreed"]);
    expect(bookmarksForModel([], null)).toBe("");
  });
  it("cleans labels and notes", () => {
    expect(cleanBookmarkLabel("  key\nmoment ")).toBe("key moment");
    expect(cleanBookmarkLabel("   ")).toBeNull();
    expect(cleanNotes("a\r\nb")).toBe("a\nb");
    expect(cleanNotes(5)).toBeNull();
    expect(cleanNotes("x".repeat(30_000))!.length).toBe(20_000);
  });
  it("passes the host's notes on, or nothing", () => {
    expect(hostNotesForModel("  Follow up with Ana  ")).toContain("Follow up with Ana");
    expect(hostNotesForModel("   ")).toBe("");
  });
  it("formats offsets", () => {
    expect(offsetClock(65_000, 0)).toBe("1:05");
    expect(offsetClock(3_723_000, 0)).toBe("1:02:03");
    expect(offsetClock(0, 5000)).toBe("0:00");
  });
});

describe("transcript text", () => {
  it("writes finals only, one per line", () => {
    const text = transcriptAsText(
      [
        { speaker: "Ana", text: "Morning ", ts: 1, final: true },
        { speaker: "Ben", text: "half a sen", ts: 2, final: false },
        { speaker: "Ben", text: "Hi", ts: 3 },
      ],
      (ts) => `t${ts}`,
    );
    expect(text).toBe("[t1] Ana: Morning\n[t3] Ben: Hi");
  });
  it("names the file after the meeting", () => {
    expect(transcriptFileName("Dunbar / Q4 review!", new Date("2026-11-06T10:00:00Z"))).toBe("dunbar-q4-review-transcript-2026-11-06.txt");
    expect(transcriptFileName("", new Date("2026-11-06T10:00:00Z"))).toBe("meeting-transcript-2026-11-06.txt");
  });
});

describe("mergeFragments", () => {
  const l = (id: string, speakerId: string, text: string, ts: number, final = true) => ({ id, speakerId, text, ts, final });
  it("joins one speaker's close fragments into a turn", () => {
    const out = mergeFragments([l("1", "a", "So the", 0), l("2", "a", "price is ten.", 3000), l("3", "b", "Agreed.", 4000)]);
    expect(out.map((t) => [t.text, t.parts])).toEqual([["So the price is ten.", 2], ["Agreed.", 1]]);
    expect(out[0].id).toBe("1");
  });
  it("keeps a long pause, another speaker, or an interim line apart", () => {
    expect(mergeFragments([l("1", "a", "One.", 0), l("2", "a", "Two.", 20_000)])).toHaveLength(2);
    expect(mergeFragments([l("1", "a", "One.", 0), l("2", "a", "tw", 1000, false)])).toHaveLength(2);
  });
});

describe("liveNotesDue", () => {
  it("waits for enough new talk and a minute between rewrites", () => {
    expect(liveNotesDue({ lines: 0, lastLines: 0, lastAt: null }, 0)).toBe(false);
    expect(liveNotesDue({ lines: 6, lastLines: 0, lastAt: null }, 0)).toBe(true);
    expect(liveNotesDue({ lines: 10, lastLines: 6, lastAt: null }, 0)).toBe(false);
    expect(liveNotesDue({ lines: 20, lastLines: 6, lastAt: 0 }, 30_000)).toBe(false);
    expect(liveNotesDue({ lines: 20, lastLines: 6, lastAt: 0 }, 61_000)).toBe(true);
  });
  it("lets a refresh on request through sooner, if anything is new", () => {
    expect(liveNotesDue({ lines: 7, lastLines: 6, lastAt: 0 }, 20_000, true)).toBe(true);
    expect(liveNotesDue({ lines: 6, lastLines: 6, lastAt: 0 }, 20_000, true)).toBe(false);
    expect(liveNotesDue({ lines: 9, lastLines: 6, lastAt: 0 }, 5_000, true)).toBe(false);
  });
});
