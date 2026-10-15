// lib/meetings/webm-cluster.ts
// Where a stored part can safely be started from.
//
// A recording is uploaded as parts cut every few seconds by the recorder's
// timeslice. The cut is made wherever the muxer happens to be, which is
// between two blocks and not between two clusters — so every part after the
// first begins partway through a cluster whose header lives in the part before
// it. Played from the start that does not matter: the bytes arrive in order
// and the parser carries on where it left off.
//
// A seek is different. It appends one part, on its own, after whatever the
// buffer last held, and the browser's WebM parser is handed a run of blocks
// belonging to a cluster it never saw. Whether it copes depends on the bytes:
// measured against recordings made with this app's own settings, about one
// seek in five into video ended the media source with a decode error, and the
// player never recovered from it. Starting the appended run at a cluster
// header — a point the parser can always begin from — removes the dependence.
//
// Pure: bytes in, an offset out.

/** EBML ID of a Cluster. */
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75] as const;

/** EBML ID of a Cluster's Timecode, which the muxers this app records with write first. */
const TIMECODE_ID = 0xe7;

/**
 * The width in bytes of an EBML size field, from its first byte, or 0 when the
 * byte cannot begin one (an all-zero byte is not a valid length marker).
 */
function sizeWidth(first: number): number {
  for (let width = 1; width <= 8; width++) {
    if (first & (0x100 >> width)) return width;
  }
  return 0;
}

/**
 * Whether a Cluster header starts at `at`.
 *
 * Four bytes are not enough to trust: they can occur inside compressed video
 * and a false match would cut a part in the wrong place. So the ID has to be
 * followed by a well-formed size field and — when `strict` — by the Timecode
 * element every cluster opens with, which makes an accidental match vanishingly
 * unlikely.
 */
function clusterAt(bytes: Uint8Array, at: number, strict: boolean): boolean {
  for (let i = 0; i < CLUSTER_ID.length; i++) {
    if (bytes[at + i] !== CLUSTER_ID[i]) return false;
  }
  const sizeAt = at + CLUSTER_ID.length;
  if (sizeAt >= bytes.length) return false;
  const width = sizeWidth(bytes[sizeAt]);
  if (width === 0) return false;
  if (!strict) return sizeAt + width <= bytes.length;
  return bytes[sizeAt + width] === TIMECODE_ID;
}

/**
 * The offset of the first Cluster header in a run of bytes, or -1 if there is
 * none.
 *
 * Looks for a header followed by its Timecode first, and only falls back to the
 * ID with a valid size field when no such header exists, so a muxer that orders
 * a cluster's children differently still gets a cut rather than none.
 */
export function firstClusterOffset(bytes: Uint8Array): number {
  const last = bytes.length - CLUSTER_ID.length;
  for (const strict of [true, false]) {
    for (let i = 0; i <= last; i++) {
      if (bytes[i] === CLUSTER_ID[0] && clusterAt(bytes, i, strict)) return i;
    }
  }
  return -1;
}

/**
 * The bytes from the first Cluster header on, or null when there is none.
 *
 * Returns a view, not a copy: parts are about a megabyte and a seek makes one
 * of these per run.
 */
export function startAtCluster(bytes: Uint8Array): Uint8Array | null {
  const at = firstClusterOffset(bytes);
  return at < 0 ? null : bytes.subarray(at);
}
