/**
 * The paging loop that stops a long meeting losing its ending.
 *
 * The defect these cover is invisible by construction: PostgREST's `max_rows`
 * cap (1000, set in supabase/config.toml) truncates a read and returns no
 * error, no flag and no short page. So the tests are about the LOOP — that it
 * asks again, that it stops on a short page and not before, and that a failed
 * page is never quietly returned as a whole transcript.
 */
import {
  TRANSCRIPT_MAX_PAGES,
  TRANSCRIPT_PAGE_SIZE,
  isLastPage,
  readAllTranscriptRows,
  transcriptPageRange,
} from "@/lib/meetings/transcript-read";

type Row = { text: string };

/** A source of `total` rows that answers `.range()` the way PostgREST does. */
function source(total: number) {
  const calls: Array<{ from: number; to: number }> = [];
  const read = (from: number, to: number) => {
    calls.push({ from, to });
    const rows: Row[] = [];
    for (let i = from; i <= Math.min(to, total - 1); i += 1) rows.push({ text: `line ${i}` });
    return Promise.resolve({ data: rows, error: null });
  };
  return { calls, read };
}

describe("transcriptPageRange", () => {
  it("is inclusive on both ends, as PostgREST's range is", () => {
    expect(transcriptPageRange(0, 500)).toEqual({ from: 0, to: 499 });
    expect(transcriptPageRange(1, 500)).toEqual({ from: 500, to: 999 });
  });

  // A page larger than the cap would come back truncated, and a truncated page
  // is a full page — so the loop would stop reading and call it the end.
  it("never asks for more rows than the PostgREST cap returns", () => {
    expect(TRANSCRIPT_PAGE_SIZE).toBeLessThanOrEqual(1000);
  });
});

describe("isLastPage", () => {
  it("ends a read on a short page only", () => {
    expect(isLastPage(499, 500)).toBe(true);
    expect(isLastPage(500, 500)).toBe(false);
    expect(isLastPage(0, 500)).toBe(true);
  });
});

describe("readAllTranscriptRows", () => {
  it("reads a meeting that fits in one page in one request", async () => {
    const s = source(12);
    expect(await readAllTranscriptRows(s.read)).toHaveLength(12);
    expect(s.calls).toHaveLength(1);
  });

  // The whole point. A single unbounded select returns 1000 rows and stops;
  // this has to come back with all of them.
  it("reads past the row cap a single select stops at", async () => {
    const s = source(1600);
    const rows = await readAllTranscriptRows<Row>(s.read);
    expect(rows).toHaveLength(1600);
    expect(rows[0].text).toBe("line 0");
    expect(rows[1599].text).toBe("line 1599");
    expect(s.calls.length).toBeGreaterThan(1);
  });

  it("keeps the rows in the order the pages returned them", async () => {
    const rows = await readAllTranscriptRows<Row>(source(1200).read);
    expect(rows.map((r) => r.text)).toEqual(rows.map((_, i) => `line ${i}`));
  });

  it("costs one extra empty request when the last page is exactly full", async () => {
    const s = source(TRANSCRIPT_PAGE_SIZE);
    expect(await readAllTranscriptRows(s.read)).toHaveLength(TRANSCRIPT_PAGE_SIZE);
    expect(s.calls).toHaveLength(2);
  });

  it("stops at the page bound rather than reading forever", async () => {
    const s = source(TRANSCRIPT_PAGE_SIZE * (TRANSCRIPT_MAX_PAGES + 5));
    await readAllTranscriptRows(s.read);
    expect(s.calls).toHaveLength(TRANSCRIPT_MAX_PAGES);
  });

  // A partial transcript handed back as a whole one is the defect this module
  // removes, reintroduced through the error path. Callers already have the
  // posted copy in hand and already treat a throw as "use it".
  it("throws rather than returning a partial read", async () => {
    let call = 0;
    const read = (from: number, to: number) => {
      call += 1;
      if (call === 2) return Promise.resolve({ data: null, error: { message: "gone" } });
      const rows: Row[] = [];
      for (let i = from; i <= to; i += 1) rows.push({ text: `line ${i}` });
      return Promise.resolve({ data: rows, error: null });
    };
    await expect(readAllTranscriptRows<Row>(read)).rejects.toThrow("gone");
  });

  it("treats a null page as empty rather than crashing", async () => {
    const read = () => Promise.resolve({ data: null, error: null });
    expect(await readAllTranscriptRows<Row>(read)).toEqual([]);
  });
});
