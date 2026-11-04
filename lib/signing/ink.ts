// lib/signing/ink.ts
//
// Turns a photo or scan of a signature (dark ink on light paper) into the same thing the
// signature pad makes: dark ink on a transparent background, so it prints cleanly on a page.
// Pure, so it can be checked without a canvas.
const INK: [number, number, number] = [17, 24, 39];

/** Rewrites RGBA pixels in place: ink colour everywhere, opacity from how dark each pixel was. */
export function inkFromPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const darkness = Math.max(0, Math.min(255, (255 - lum - 30) * 1.4));
    data[i] = INK[0];
    data[i + 1] = INK[1];
    data[i + 2] = INK[2];
    data[i + 3] = Math.round((darkness * data[i + 3]) / 255);
  }
}

/** A size that fits (w, h) inside a box, keeping its shape. */
export function fitInside(w: number, h: number, boxW: number, boxH: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: boxW, height: boxH };
  const s = Math.min(boxW / w, boxH / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
