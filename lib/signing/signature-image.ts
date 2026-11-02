// lib/signing/signature-image.ts
//
// A drawn or typed signature arrives from the browser as a PNG data URL. It is
// untrusted input that ends up inside a PDF, so only a real, small PNG gets in.
const PREFIX = "data:image/png;base64,";
/** A signature pad is a few KB; this leaves room for a large display without letting anyone store a payload. */
export const MAX_SIGNATURE_BYTES = 150 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The PNG bytes inside a data URL, or null if it is anything else. */
export function parseSignaturePng(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIX)) return null;
  const b64 = dataUrl.slice(PREFIX.length);
  if (b64.length === 0 || b64.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  if (bytes.length < 67 || bytes.length > MAX_SIGNATURE_BYTES) return null;
  return PNG_MAGIC.every((m, i) => bytes[i] === m) ? bytes : null;
}
