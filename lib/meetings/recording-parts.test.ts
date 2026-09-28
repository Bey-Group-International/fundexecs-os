import { readAllRecordingParts } from "./recording-parts";
import { TRANSCRIPT_PAGE_SIZE } from "./transcript-read";

/** A table that, like PostgREST, never returns more than `cap` rows at once. */
function fakeClient(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, idx) => ({ idx, path: `p/${idx}` }));
  const calls: Array<{ from: number; to: number; filter: string; ordered: boolean }> = [];
  let filter = "";
  let ordered = false;
  const query = {
    select: () => query,
    eq: (_col: string, value: string) => { filter = value; return query; },
    order: () => { ordered = true; return query; },
    range: (from: number, to: number) => {
      calls.push({ from, to, filter, ordered });
      const end = Math.min(to + 1, from + cap);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
  };
  return { client: { from: () => query }, calls };
}

describe("readAllRecordingParts", () => {
  it("reads every part of a recording longer than the row cap", async () => {
    // Five-second parts: 1500 is two hours and five minutes.
    const { client } = fakeClient(1500);
    const parts = await readAllRecordingParts<{ idx: number }>(client, "rec-1", "idx, path");

    expect(parts).toHaveLength(1500);
    expect(parts[0].idx).toBe(0);
    expect(parts[1499].idx).toBe(1499);
  });

  it("asks for one recording, in part order, a page at a time", async () => {
    const { client, calls } = fakeClient(TRANSCRIPT_PAGE_SIZE + 10);
    await readAllRecordingParts(client, "rec-9", "idx");

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.filter === "rec-9" && c.ordered)).toBe(true);
    expect(calls[1].from).toBe(TRANSCRIPT_PAGE_SIZE);
  });

  it("fails rather than returning a partial list", async () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    await expect(readAllRecordingParts({ from: () => query }, "rec-1", "idx")).rejects.toThrow("boom");
  });
});
