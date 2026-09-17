// lib/meetings/transcript-read.ts
// Reading a meeting's stored transcript in full.
//
// Every read of `live_meeting_transcripts` in this product asked for the whole
// table and took whatever came back. PostgREST never answers that question:
// `supabase/config.toml` sets `max_rows = 1000`, so the API returns the first
// thousand rows and says nothing about having stopped. There is no error, no
// flag, and no short-page signal — a truncated read and a complete one are the
// same shape.
//
// All three readers order by `ts` ascending, so the thousand rows they get are
// the EARLIEST thousand, and what a long meeting silently loses is its ending.
// That is the part where a meeting decides things: the report is summarised
// from a conversation that appears to stop mid-sentence, the regenerate route
// reads the same truncated copy, and the report page's clickable cues run out
// partway through the recording.
//
// A thirty-minute call does not reach a thousand utterances. A two-hour one,
// or a busy four-person one, does.
//
// So every read pages. The loop lives here rather than at each of the three
// call sites because getting it wrong is silent in exactly the same way.

/** One page of rows, in the shape PostgREST hands back. */
export interface TranscriptPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Rows per request.
 *
 * Must stay at or below the `max_rows` cap, or the short-page test below stops
 * meaning "last page" and starts meaning "the cap bit again". 500 matches
 * `directory.server.ts`, which pages the same database for the same reason.
 */
export const TRANSCRIPT_PAGE_SIZE = 500;

/**
 * How many pages one read will ever ask for.
 *
 * Ten thousand utterances is several hours of four people talking over each
 * other, and well past what any report would keep after `clampTranscript`. The
 * bound is here so a runaway row count cannot turn a page render into an
 * unbounded sequence of round trips, not because a real meeting approaches it.
 */
export const TRANSCRIPT_MAX_PAGES = 20;

/** The `.range()` bounds for one page — inclusive on both ends, as PostgREST is. */
export function transcriptPageRange(
  page: number,
  size: number = TRANSCRIPT_PAGE_SIZE,
): { from: number; to: number } {
  const from = page * size;
  return { from, to: from + size - 1 };
}

/**
 * Whether a page that came back this size means there are no more.
 *
 * Only a SHORT page ends a read. A page that comes back exactly full may be
 * the last one, in which case the next request costs one empty round trip —
 * which is the cheap side of the mistake to make.
 */
export function isLastPage(rowCount: number, size: number = TRANSCRIPT_PAGE_SIZE): boolean {
  return rowCount < size;
}

/**
 * Read every row a paged query can return.
 *
 * The caller supplies the query rather than a client, because the three places
 * that need this hold three different Supabase clients — two server ones and
 * the viewer's own browser client, under three different sets of RLS rules —
 * and the part worth sharing is the loop, not the connection.
 *
 * A page that fails takes the whole read with it. A partial transcript is the
 * defect this module exists to remove, and returning one through the error
 * path would reintroduce it in the one place nobody would look. Every caller
 * already treats a failed read as "use the copy in hand", which is the right
 * answer and an honest one.
 */
export async function readAllTranscriptRows<T>(
  readPage: (from: number, to: number) => PromiseLike<TranscriptPage<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < TRANSCRIPT_MAX_PAGES; page += 1) {
    const { from, to } = transcriptPageRange(page);
    const { data, error } = await readPage(from, to);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (isLastPage(rows.length)) break;
  }
  return out;
}
