// A tiny pixel-art engine for the Virtual Office characters.
//
// FULLY PROCEDURAL — no image or binary assets. A sprite "frame" is just an
// array of strings, one per pixel row, where each character is a palette key
// and a space is transparent. The engine paints one crisp rectangle per
// non-space pixel, so the same hand-authored art scales to any avatar height
// without blurring. Kept DOM-light (the only browser touch is the passed-in
// 2D context) so the geometry stays testable and the draw loop stays cheap.

/** Maps single-character sprite keys to CSS fill colors. */
export type Palette = Record<string, string>;

/**
 * Paint one pixel matrix into a canvas context. Each non-space character in
 * `rows` is filled as a `pxSize`-scaled rectangle anchored at (originX, originY);
 * missing palette keys and spaces are skipped (transparent). Rectangle edges are
 * integer-aligned so neighbouring pixels tile seamlessly with no seams or gaps,
 * keeping the art crisp at any scale. When `flipX` is set the row is mirrored
 * horizontally (used to derive a left-facing sprite from a right-facing one).
 */
export function drawPixelMatrix(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  palette: Palette,
  originX: number,
  originY: number,
  pxSize: number,
  flipX = false,
): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    const w = row.length;
    // Integer-align the top edge of this row once.
    const top = Math.round(originY + y * pxSize);
    const bottom = Math.round(originY + (y + 1) * pxSize);
    const h = bottom - top;
    for (let x = 0; x < w; x++) {
      const key = row[x];
      if (key === " ") continue;
      const color = palette[key];
      if (!color) continue;
      // Mirror the column index for left-facing draws.
      const col = flipX ? w - 1 - x : x;
      const left = Math.round(originX + col * pxSize);
      const right = Math.round(originX + (col + 1) * pxSize);
      ctx.fillStyle = color;
      ctx.fillRect(left, top, right - left, h);
    }
  }
}
