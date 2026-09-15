// lib/meetings/recording-range.ts
// Serving one video out of many stored parts.
//
// A recording is uploaded in five-second parts while the meeting runs, because
// that is what makes it survive the host's laptop closing. It is watched as one
// file. Nothing in between ever stitches them: Supabase Storage cannot
// concatenate server-side, and pulling 675MB through a serverless function to
// rewrite it as one object would cost more than storing it twice.
//
// So the parts stay parts, and the playback route presents them as a single
// byte stream. That is enough for a browser to play — and, because the route
// answers Range requests by mapping the requested bytes onto the parts that
// hold them, enough to SEEK. Without that a viewer can only watch an hour-long
// meeting from the beginning, which is not really watching it at all.
//
// The arithmetic is fiddly and entirely testable, so it lives here rather than
// inline in a route handler where an off-by-one would show up as a video that
// plays for an hour and then reports a decode error.

/** One stored part, in order. */
export interface RecordingChunk {
  path: string;
  size: number;
}

/** A slice of one part that a response needs. */
export interface ChunkSlice {
  path: string;
  /** Inclusive byte offset within the part. */
  start: number;
  /** EXCLUSIVE byte offset within the part. */
  end: number;
}

export interface ByteRange {
  /** Inclusive. */
  start: number;
  /** Inclusive, as HTTP means it. */
  end: number;
}

/** Total size of the assembled recording. */
export function totalSize(chunks: readonly RecordingChunk[]): number {
  return chunks.reduce((n, c) => n + Math.max(0, c.size), 0);
}

/**
 * Parse a `Range` header.
 *
 * Only the single-range byte form, which is the only one browsers send for
 * media. Returns null for anything else — a malformed or multi-range header is
 * answered with the whole file, which is always correct if not always minimal.
 *
 * Handles the suffix form (`bytes=-500`, meaning the LAST 500 bytes), which is
 * how some players probe a container's trailing metadata. Getting that
 * backwards serves the beginning of the file to something looking for the end,
 * and the video simply never starts.
 */
export function parseRange(header: string | null, size: number): ByteRange | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/**
 * Which parts hold a range, and which bytes of each.
 *
 * Walks the parts accumulating offsets, and emits a slice for every part the
 * range touches. Parts entirely before or after the range produce nothing, so
 * seeking to the last minute of a meeting reads one or two objects rather than
 * all seven hundred.
 */
export function slicesForRange(
  chunks: readonly RecordingChunk[],
  range: ByteRange,
): ChunkSlice[] {
  const slices: ChunkSlice[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    const size = Math.max(0, chunk.size);
    if (size === 0) continue;
    const chunkStart = offset;
    const chunkEnd = offset + size; // exclusive
    offset = chunkEnd;

    if (chunkEnd <= range.start) continue;
    if (chunkStart > range.end) break;

    slices.push({
      path: chunk.path,
      start: Math.max(0, range.start - chunkStart),
      // `range.end` is inclusive; slice ends are exclusive.
      end: Math.min(size, range.end - chunkStart + 1),
    });
  }
  return slices;
}

/** The `Content-Range` value for a partial response. */
export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

/** How many bytes a range covers. */
export function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}

/**
 * Sort parts into playback order by their path.
 *
 * Paths are zero-padded by `chunkPath`, so a plain string sort is the right
 * one — but only because of that padding. Sorting is done here, next to the
 * comment explaining why it is safe, rather than being assumed at each call
 * site: parts come back from a storage listing in whatever order the API
 * chose, and assembling a meeting in that order would produce an hour of video
 * whose middle is somewhere near the start.
 */
export function inPlaybackOrder<T extends { path: string }>(chunks: readonly T[]): T[] {
  return [...chunks].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
