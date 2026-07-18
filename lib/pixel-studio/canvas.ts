/**
 * Browser canvas bridge — blits a Raster to a <canvas> with all smoothing
 * disabled and integer-aligned draws, honoring the native-pixel contract.
 * DOM-dependent; import only from client components.
 */
import { Raster } from "./raster";

/** Disable every smoothing/interpolation hook a 2D context exposes. */
export function hardenContext(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false;
  // Vendor-prefixed fallbacks (older engines).
  const anyCtx = ctx as unknown as Record<string, unknown>;
  anyCtx.mozImageSmoothingEnabled = false;
  anyCtx.webkitImageSmoothingEnabled = false;
  anyCtx.msImageSmoothingEnabled = false;
}

/** Convert a Raster into an ImageData for putImageData / createImageBitmap. */
export function rasterToImageData(raster: Raster): ImageData {
  return new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height);
}

/**
 * Draw a native Raster into a display canvas at integer `scale` using
 * nearest-neighbor. The source is first put 1:1 onto an offscreen canvas, then
 * drawn scaled with smoothing off — an exact pixel-doubling with no
 * interpolation.
 */
export function drawRasterScaled(
  target: HTMLCanvasElement,
  raster: Raster,
  scale: number,
): void {
  const ctx = target.getContext("2d");
  if (!ctx) return;
  target.width = raster.width * scale;
  target.height = raster.height * scale;

  const off = document.createElement("canvas");
  off.width = raster.width;
  off.height = raster.height;
  const octx = off.getContext("2d");
  if (!octx) return;
  octx.putImageData(rasterToImageData(raster), 0, 0);

  hardenContext(ctx);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(off, 0, 0, raster.width, raster.height, 0, 0, target.width, target.height);
}

/** Convert a Raster to a PNG data URL (browser export path). */
export function rasterToDataUrl(raster: Raster): string {
  const off = document.createElement("canvas");
  off.width = raster.width;
  off.height = raster.height;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.putImageData(rasterToImageData(raster), 0, 0);
  return off.toDataURL("image/png");
}

/** Raster → PNG bytes (Uint8Array) via canvas, for browser-side ZIP bundles. */
export async function rasterToPngBytes(raster: Raster): Promise<Uint8Array> {
  const off = document.createElement("canvas");
  off.width = raster.width;
  off.height = raster.height;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.putImageData(rasterToImageData(raster), 0, 0);
  const blob: Blob = await new Promise((resolve, reject) =>
    off.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
