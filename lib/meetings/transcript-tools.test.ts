import {
  applyOverlay,
  cleanLineText,
  cleanSpeakerName,
  durationLabel,
  exportFileName,
  exportLines,
  isExportFormat,
  momentUrl,
  overlayFrom,
  quoteFor,
  renameInText,
  speakersHeard,
  talkStats,
  toMarkdown,
  toSrt,
  toText,
  toVtt,
  type OverlayRow,
} from "./transcript-tools";
import { transcriptCues } from "./transcript-cues";

const START = Date.parse("2026-11-06T10:00:00.000Z");
const at = (s: number) => new Date(START + s * 1000).toISOString();
const row = (id: string, speaker: string, text: string, s: number): OverlayRow => ({ id, speaker, text, ts: at(s) });

const ROWS: OverlayRow[] = [
  row("a", "Speaker 1", "Thanks for joining. Shall we start?", 0),
  row("b", "Speaker 2", "Sure, the fund is at forty million.", 5),
  row("c", "Speaker 2", "We close in March.", 9),
  row("d", "Speaker 1", "Great.", 14),
];

describe("cleaning", () => {
  it("keeps a name to one tidy line", () => {
    expect(cleanSpeakerName("  Dana\n Okafor ")).toBe("Dana Okafor");
    expect(cleanSpeakerName("x".repeat(200))).toHaveLength(80);
    expect(cleanSpeakerName("   ")).toBeNull();
    expect(cleanSpeakerName(7)).toBeNull();
  });
  it("keeps a corrected line, tidied", () => {
    expect(cleanLineText("  forty  million \t ")).toBe("forty million");
    expect(cleanLineText("")).toBeNull();
  });
});

describe("applyOverlay", () => {
  const overlay = overlayFrom([{ original: "Speaker 2", display: "Dana Okafor" }], [{ line_id: "c", text: "We close in May." }]);

  it("puts names on labels and corrections on lines, keeping what was heard", () => {
    const shown = applyOverlay(ROWS, overlay);
    expect(shown[1]).toMatchObject({ speaker: "Dana Okafor", originalSpeaker: "Speaker 2", text: "Sure, the fund is at forty million." });
    expect(shown[2]).toMatchObject({ speaker: "Dana Okafor", text: "We close in May.", original: "We close in March." });
    expect(shown[0]).not.toHaveProperty("originalSpeaker");
    expect(shown[0]).not.toHaveProperty("original");
  });

  it("never changes the stored rows", () => {
    applyOverlay(ROWS, overlay);
    expect(ROWS[2].text).toBe("We close in March.");
    expect(ROWS[1].speaker).toBe("Speaker 2");
  });

  it("carries line ids and corrections into the cues, paragraph by paragraph", () => {
    const cues = transcriptCues(applyOverlay(ROWS, overlay), at(0));
    expect(cues[1]).toMatchObject({
      speaker: "Dana Okafor",
      paragraphs: ["Sure, the fund is at forty million.", "We close in May."],
      lineIds: ["b", "c"],
      originals: [null, "We close in March."],
    });
  });

  it("leaves cues as they were for rows read without ids", () => {
    const cues = transcriptCues(ROWS.map(({ id: _id, ...r }) => r), at(0));
    expect(cues[0]).not.toHaveProperty("lineIds");
  });
});

describe("renameInText", () => {
  const names = new Map([["Speaker 1", "Ann Lee"]]);
  it("renames whole speaker labels at the start of a line only", () => {
    const text = "Speaker 1: Hello.\nSpeaker 10: Hi.\nSpeaker 1 (uncertain): Speaker 1: is me.";
    expect(renameInText(text, names)).toBe("Ann Lee: Hello.\nSpeaker 10: Hi.\nAnn Lee (uncertain): Speaker 1: is me.");
  });
  it("does nothing without names", () => {
    expect(renameInText("Speaker 1: Hello.", new Map())).toBe("Speaker 1: Hello.");
  });
});

describe("speakersHeard", () => {
  it("lists labels as heard, most-spoken first", () => {
    expect(speakersHeard(ROWS)).toEqual(["Speaker 1", "Speaker 2"]);
  });
  it("falls back to the stored text", () => {
    expect(speakersHeard([], "Bob: hi\nAnn: hello\nAnn: again")).toEqual(["Ann", "Bob"]);
  });
});

describe("talkStats", () => {
  it("shares out speaking time from when lines were said", () => {
    const s = talkStats(ROWS);
    const one = s.speakers.find((x) => x.speaker === "Speaker 1")!;
    const two = s.speakers.find((x) => x.speaker === "Speaker 2")!;
    // Speaker 2: 5s→9s and 9s→14s; Speaker 1: 0s→5s, then "Great." by its length.
    expect(two.ms).toBe(9_000);
    expect(two.turns).toBe(1);
    expect(one.turns).toBe(2);
    expect(one.questions).toBe(1);
    expect(Math.round((one.share + two.share) * 100)).toBe(100);
    expect(s.speakers[0].speaker).toBe("Speaker 2");
    expect(s.monologue).toBeNull();
  });

  it("does not count a long silence as speech", () => {
    const s = talkStats([row("a", "A", "one two three", 0), row("b", "B", "four", 600)]);
    expect(s.speakers.find((x) => x.speaker === "A")!.ms).toBeLessThan(5_000);
  });

  it("names a long unbroken stretch", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(String(i), "Ann", "word ".repeat(30), i * 15));
    rows.push(row("z", "Bob", "Thanks.", 300));
    expect(talkStats(rows).monologue).toMatchObject({ speaker: "Ann" });
  });

  it("labels durations", () => {
    expect(durationLabel(45_000)).toBe("45s");
    expect(durationLabel(250_000)).toBe("4m 10s");
    expect(durationLabel(3_720_000)).toBe("1h 02m");
  });
});

describe("export", () => {
  const lines = exportLines(applyOverlay(ROWS, overlayFrom([{ original: "Speaker 2", display: "Dana" }], [])), START);

  it("times lines from the origin", () => {
    expect(lines.map((l) => l.atMs)).toEqual([0, 5000, 9000, 14000]);
  });

  it("writes plain text by turn, with or without times", () => {
    expect(toText(lines, { title: "Call", timestamps: true })).toBe(
      "Call\n\n[0:00] Speaker 1: Thanks for joining. Shall we start?\n\n[0:05] Dana: Sure, the fund is at forty million. We close in March.\n\n[0:14] Speaker 1: Great.\n",
    );
    expect(toText(lines, { title: "Call", timestamps: false })).toContain("\nDana: Sure");
  });

  it("writes Markdown with the words escaped", () => {
    const md = toMarkdown([{ speaker: "A*B", text: "use _this_ <b>", atMs: 0 }], { title: "# Call", timestamps: false });
    expect(md).toBe("# \\# Call\n\n**A\\*B**\n\nuse \\_this\\_ \\<b\\>\n");
  });

  it("writes SRT captions that end where the next line starts", () => {
    const srt = toSrt(lines);
    expect(srt.startsWith("1\n00:00:00,000 --> 00:00:05,000\nSpeaker 1: Thanks for joining. Shall we start?\n\n2\n00:00:05,000 --> 00:00:09,000\n")).toBe(true);
  });

  it("writes WebVTT with the words escaped, so no line can end its cue or open a tag", () => {
    const vtt = toVtt([{ speaker: "", text: "a --> b <i>&", atMs: 1_500 }]);
    expect(vtt).toBe("WEBVTT\n\n00:00:01.500 --> 00:00:03.100\na --&gt; b &lt;i&gt;&amp;\n");
  });

  it("names the file by date and checks the format", () => {
    expect(exportFileName(new Date("2026-11-06T10:00:00Z"), "srt")).toBe("meeting-transcript-2026-11-06.srt");
    expect(isExportFormat("docx")).toBe(true);
    expect(isExportFormat("pdf")).toBe(false);
  });
});

describe("quotes", () => {
  it("quotes the words, who and when, with a link to the moment", () => {
    const url = momentUrl("https://app.example/meetings/abc/report?x=1#transcript", 125_400);
    expect(url).toBe("https://app.example/meetings/abc/report?x=1&t=125");
    expect(quoteFor({ speaker: "Dana", text: " We close in May. ", atMs: 125_400, url })).toBe(
      "“We close in May.” — Dana (2:05)\nhttps://app.example/meetings/abc/report?x=1&t=125",
    );
    expect(quoteFor({ speaker: "", text: "Hi", atMs: null, url: null })).toBe("“Hi” — Unattributed");
  });
});
