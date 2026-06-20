// lib/data-room.test.ts
// Unit tests for the data-room coverage summary.
import { summarizeDataRoom, DATA_ROOM_SECTIONS } from "@/lib/data-room";

describe("summarizeDataRoom", () => {
  it("treats Build-backed sections as ready when their module holds data", () => {
    const s = summarizeDataRoom(
      { profile: "started", thesis: "complete", track_record: "empty" },
      {},
    );
    const overview = s.items.find((i) => i.key === "overview")!;
    const thesis = s.items.find((i) => i.key === "thesis")!;
    const track = s.items.find((i) => i.key === "track_record")!;
    expect(overview.ready).toBe(true);
    expect(overview.viaBuild).toBe(true);
    expect(thesis.ready).toBe(true);
    expect(track.ready).toBe(false);
  });

  it("treats doc-only sections as ready when a document is present", () => {
    const s = summarizeDataRoom({}, { financials: 2, diligence: 0 });
    const fin = s.items.find((i) => i.key === "financials")!;
    const dd = s.items.find((i) => i.key === "diligence")!;
    expect(fin.ready).toBe(true);
    expect(fin.docCount).toBe(2);
    expect(fin.viaBuild).toBe(false);
    expect(dd.ready).toBe(false);
  });

  it("excludes the catch-all section and computes a percentage", () => {
    const s = summarizeDataRoom({}, {});
    expect(s.items.some((i) => i.key === "other")).toBe(false);
    expect(s.total).toBe(DATA_ROOM_SECTIONS.filter((x) => !x.catchAll).length);
    expect(s.readyCount).toBe(0);
    expect(s.percent).toBe(0);
  });

  it("counts ready sections toward the percentage", () => {
    const s = summarizeDataRoom({ profile: "complete", team: "started" }, { financials: 1 });
    expect(s.readyCount).toBe(3); // overview, team, financials
    expect(s.percent).toBe(Math.round((3 / s.total) * 100));
  });
});
