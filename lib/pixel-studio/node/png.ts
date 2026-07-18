/**
 * Minimal, dependency-free PNG encoder/decoder for build-time asset generation.
 *
 * NODE-ONLY: imports `node:zlib`. Never import this from client/browser code —
 * the browser export path uses canvas.toBlob() instead. Keeping it under
 * `node/` documents that boundary. Encodes truecolor-with-alpha (color type 6,
 * 8-bit) which is exactly what transparent pixel sprites need.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { Raster } from "../raster";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode a Raster to a PNG Buffer (color type 6, no filtering). */
export function encodePng(raster: Raster): Buffer {
  const { width, height, data } = raster;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: truecolor + alpha
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Raw scanlines, each prefixed with filter-type byte 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = data[y * stride + x];
    }
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface DecodedPng {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  raster: Raster;
}

/**
 * Decode a PNG produced by encodePng (or any color-type-6, 8-bit, filter-0
 * PNG). Sufficient for the validators to read back dimensions and alpha; not a
 * general-purpose decoder.
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  let bitDepth = 8;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + len + 4;
  }

  if (colorType !== 6 || bitDepth !== 8) {
    // Return metadata without pixels for unsupported encodings.
    return { width, height, colorType, bitDepth, raster: new Raster(width, height) };
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const raster = new Raster(width, height);
  // Undo PNG per-scanline filtering (support None/Sub/Up/Average/Paeth).
  const out = raster.data;
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let val = line[x];
      switch (filter) {
        case 1: val = (val + a) & 0xff; break;
        case 2: val = (val + b) & 0xff; break;
        case 3: val = (val + ((a + b) >> 1)) & 0xff; break;
        case 4: val = (val + paeth(a, b, c)) & 0xff; break;
      }
      cur[x] = val;
      out[y * stride + x] = val;
    }
    prev.set(cur);
  }
  return { width, height, colorType, bitDepth, raster };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Read only IHDR (fast, for validators that just need dimensions). */
export function readPngDimensions(buf: Buffer): { width: number; height: number } {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
