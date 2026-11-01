import { chunk, selectAllPages, selectInBatches } from "./batch";

describe("chunk", () => {
  it("splits into batches and keeps every item", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const batches = chunk(items, 100);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(items);
  });
  it("is empty for nothing", () => expect(chunk([], 100)).toEqual([]));
});

describe("selectInBatches", () => {
  it("never sends more ids than the batch size, and returns every row", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const seen: number[] = [];
    const { data, error } = await selectInBatches<{ id: string }>(ids, async (batch) => {
      seen.push(batch.length);
      return { data: batch.map((id) => ({ id })), error: null };
    });
    expect(error).toBeNull();
    expect(Math.max(...seen)).toBeLessThanOrEqual(100);
    expect(data).toHaveLength(250);
  });

  it("does not repeat an id that was passed twice", async () => {
    const calls: string[][] = [];
    await selectInBatches(["a", "a", "b"], async (batch) => {
      calls.push(batch);
      return { data: [], error: null };
    });
    expect(calls).toEqual([["a", "b"]]);
  });

  it("makes no request for no ids", async () => {
    const run = jest.fn();
    const out = await selectInBatches([], run);
    expect(out).toEqual({ data: [], error: null });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the error, not a partial list, when any batch fails", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const out = await selectInBatches<{ id: string }>(ids, async (batch) =>
      batch[0] === "id-100" ? { data: null, error: { message: "boom" } } : { data: batch.map((id) => ({ id })), error: null },
    );
    expect(out.data).toBeNull();
    expect(out.error?.message).toBe("boom");
  });
});

describe("selectAllPages", () => {
  const table = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
  const page = (from: number, to: number) => ({ data: table.slice(from, to + 1), error: null });

  it("reads past one page, in order, with nothing skipped or repeated", async () => {
    const { data } = await selectAllPages<{ n: number }>(async (f, t) => page(f, t), 1000);
    expect(data).toHaveLength(2500);
    expect(data?.map((r) => r.n)).toEqual(table.map((r) => r.n));
  });

  it("stops after a short page, with one request when everything fits", async () => {
    const run = jest.fn(async (f: number, t: number) => ({ data: table.slice(f, Math.min(t + 1, 10)), error: null }));
    const { data } = await selectAllPages<{ n: number }>(run, 1000);
    expect(data).toHaveLength(10);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("asks again after an exactly full last page, then stops on the empty one", async () => {
    const exact = Array.from({ length: 2000 }, (_, i) => ({ n: i }));
    const run = jest.fn(async (f: number, t: number) => ({ data: exact.slice(f, t + 1), error: null }));
    const { data } = await selectAllPages<{ n: number }>(run, 1000);
    expect(data).toHaveLength(2000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("returns the error, not a partial list, when a page fails", async () => {
    const out = await selectAllPages<{ n: number }>(async (f, t) =>
      f >= 1000 ? { data: null, error: { message: "page 2 failed" } } : page(f, t),
    );
    expect(out.data).toBeNull();
    expect(out.error?.message).toBe("page 2 failed");
  });
});
