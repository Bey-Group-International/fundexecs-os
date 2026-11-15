import { captionTurns, CAPTION_TTL_MS } from "./CaptionStrip";

const line = (id: string, speakerId: string, text: string, ts: number, isLocal = false) => ({ id, speakerId, speaker: speakerId.toUpperCase(), text, ts, isLocal });

describe("captionTurns", () => {
  it("merges a run by one speaker and labels the local one 'You'", () => {
    const t = captionTurns([line("1", "a", "hello", 1000), line("2", "a", "there", 1100), line("3", "local", "hi", 1200, true)], 2000);
    expect(t).toEqual([{ key: "1", speaker: "A", text: "hello there" }, { key: "3", speaker: "You", text: "hi" }]);
  });
  it("drops stale and empty lines and keeps only the last two turns", () => {
    const t = captionTurns([line("0", "z", "old", 0), line("1", "a", "  ", 9000), line("2", "a", "one", 9000), line("3", "b", "two", 9100), line("4", "c", "three", 9200)], CAPTION_TTL_MS + 3000);
    expect(t.map((x) => x.text)).toEqual(["two", "three"]);
  });
});
