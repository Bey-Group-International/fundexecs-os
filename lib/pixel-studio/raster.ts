/**
 * Raster — a DOM-free RGBA pixel buffer.
 *
 * The pixel compositor paints onto a Raster rather than a canvas so the exact
 * same code path runs (a) in the browser, where the buffer is blitted to a
 * <canvas> via putImageData, and (b) headless in Node build scripts, where the
 * buffer is PNG-encoded. Every operation writes at integer coordinates with no
 * interpolation — this is the hard-edged, nearest-neighbor contract.
 */
import type { Rgba } from "./palette-engine";

export class Raster {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  private idx(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Read a pixel (returns transparent black when out of bounds). */
  get(x: number, y: number): Rgba {
    if (!this.inBounds(x, y)) return { r: 0, g: 0, b: 0, a: 0 };
    const i = this.idx(x, y);
    return { r: this.data[i], g: this.data[i + 1], b: this.data[i + 2], a: this.data[i + 3] };
  }

  /** Hard write — replaces the pixel outright (no blending). */
  set(x: number, y: number, c: Rgba): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.data[i] = c.r;
    this.data[i + 1] = c.g;
    this.data[i + 2] = c.b;
    this.data[i + 3] = c.a;
  }

  /**
   * Source-over alpha composite of a single pixel. Kept deliberately simple:
   * native art uses fully opaque pixels, so most writes hit the fast opaque
   * path; partial alpha only appears in the (separate) PBR showcase pipeline.
   */
  blend(x: number, y: number, c: Rgba): void {
    if (!this.inBounds(x, y)) return;
    if (c.a === 0) return;
    if (c.a === 255) {
      this.set(x, y, c);
      return;
    }
    const i = this.idx(x, y);
    const sa = c.a / 255;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA === 0) return;
    this.data[i] = (c.r * sa + this.data[i] * da * (1 - sa)) / outA;
    this.data[i + 1] = (c.g * sa + this.data[i + 1] * da * (1 - sa)) / outA;
    this.data[i + 2] = (c.b * sa + this.data[i + 2] * da * (1 - sa)) / outA;
    this.data[i + 3] = outA * 255;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    }
  }

  /** Horizontal run of pixels — the workhorse of the pixel painters. */
  hline(x: number, y: number, len: number, c: Rgba): void {
    for (let i = 0; i < len; i++) this.set(x + i, y, c);
  }

  vline(x: number, y: number, len: number, c: Rgba): void {
    for (let i = 0; i < len; i++) this.set(x, y + i, c);
  }

  /** Composite another raster on top at (dx, dy) using source-over blend. */
  composite(src: Raster, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c.a !== 0) this.blend(dx + x, dy + y, c);
      }
    }
  }

  /**
   * Nearest-neighbor integer upscale. This is the ONLY scaling permitted for
   * review images — no interpolation, no smoothing. An 8× enlargement of a
   * 32×32 frame is an exact 256×256 replica.
   */
  scaleNearest(factor: number): Raster {
    if (!Number.isInteger(factor) || factor < 1) {
      throw new Error(`scaleNearest requires an integer factor >= 1, got ${factor}`);
    }
    const out = new Raster(this.width * factor, this.height * factor);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.get(x, y);
        out.fillRect(x * factor, y * factor, factor, factor, c);
      }
    }
    return out;
  }

  /** Extract a sub-region as a new Raster. */
  crop(x: number, y: number, w: number, h: number): Raster {
    const out = new Raster(w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) out.set(xx, yy, this.get(x + xx, y + yy));
    }
    return out;
  }

  clone(): Raster {
    return new Raster(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  /** True if every pixel is either fully opaque or fully transparent. */
  hasOnlyBinaryAlpha(): boolean {
    for (let i = 3; i < this.data.length; i += 4) {
      const a = this.data[i];
      if (a !== 0 && a !== 255) return false;
    }
    return true;
  }

  /** Count of non-transparent pixels — used by validators (silhouette check). */
  opaqueCount(): number {
    let n = 0;
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) n++;
    return n;
  }
}
