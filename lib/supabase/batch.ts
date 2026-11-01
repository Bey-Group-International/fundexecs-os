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
/** Rows per page. Matches PostgREST's `max_rows`, so a full page means "ask again". */
export const PAGE_SIZE = 1000;
/** A runaway guard, not a real limit: 1000 pages is a million rows. */
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
 */
export async function selectAllPages<T>(
  run: (from: number, to: number) => PromiseLike<BatchResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<BatchResult<T>> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const got = data ?? [];
    rows.push(...got);
    // A short page is the last one; a full page may be truncated, so ask again.
    if (got.length < pageSize) return { data: rows, error: null };
  }
  return { data: rows, error: null };
}
