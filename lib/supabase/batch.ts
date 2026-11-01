// lib/supabase/batch.ts
//
// Two limits that quietly cut a data room's file list short once a room is big.
//
//  1. A filter like `.in("id", ids)` puts every id in the request URL. At about
//     40 bytes an id, a couple of hundred files overflow the URL limit of the
//     API gateway, and the whole read fails.
//  2. PostgREST returns at most `max_rows` rows (1000 in this project's
//     config) however many match, and says nothing when it truncates.
//
// Either one means a reader sees part of the room with no error. These two
// helpers keep every read of "all the files in this room" under both limits.

/** Ids per request. 100 ids is ~4 KB of URL, well under any gateway limit. */
export const ID_BATCH_SIZE = 100;
/** Rows asked for per page. The server may return fewer: see selectAllPages. */
export const PAGE_SIZE = 1000;
/**
 * A runaway guard, not a real limit: 1000 pages is a million rows at the default
 * cap, and still 100,000 under a cap of 100. Hitting it is reported as an error.
 */
const MAX_PAGES = 1000;

export interface BatchResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export function chunk<T>(items: readonly T[], size: number = ID_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run an `.in()`-style query once per batch of ids and join the rows. The first
 * error wins: a partial answer is not returned as though it were complete.
 */
export async function selectInBatches<T>(
  ids: readonly string[],
  run: (batch: string[]) => PromiseLike<BatchResult<T>>,
  size: number = ID_BATCH_SIZE,
): Promise<BatchResult<T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { data: [], error: null };
  const results = await Promise.all(chunk(unique, size).map((batch) => run(batch)));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { data: null, error: failed.error };
  return { data: results.flatMap((r) => r.data ?? []), error: null };
}

/**
 * Read every row of a query, a page at a time. `run(from, to)` must apply
 * `.range(from, to)` to a query with a stable, unique ordering, or rows can be
 * skipped or repeated across pages. The first error wins.
 *
 * The server decides how many rows a page really holds: PostgREST caps every
 * response at its `max_rows` setting, which is a project setting that can be
 * lower than the page asked for, and it does not say when it has cut a page
 * short. So this never infers "that was the last page" from a page being short.
 * It moves on by the number of rows it actually received, and it stops only on
 * an empty page. Treating a short page as the end, and moving on by the page
 * size, would stop early under a lower cap and skip the rows in between: 1,200
 * rows read through a cap of 500 came back as 500, with no error.
 *
 * The price is one extra, empty request at the end of every read.
 */
export async function selectAllPages<T>(
  run: (from: number, to: number) => PromiseLike<BatchResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<BatchResult<T>> {
  const rows: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const got = data ?? [];
    if (got.length === 0) return { data: rows, error: null };
    rows.push(...got);
    from += got.length;
  }
  // Out of pages without reaching the end. A truncated list must not pass as whole.
  return {
    data: null,
    error: { message: `selectAllPages gave up after ${MAX_PAGES} pages without reaching the end` },
  };
}
