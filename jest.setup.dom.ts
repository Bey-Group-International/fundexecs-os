// Matchers for the jsdom project: toBeInTheDocument, toBeDisabled, and friends.
import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";

// jsdom omits Web APIs that every real browser ships and that our client code
// legitimately uses. Fill them from Node's implementations rather than mocking
// around them, so a component test exercises the production path instead of a
// stand-in.

// TextEncoder/TextDecoder — used by the ZIP reader (lib/zip.ts) to decode entry
// names. Absent from jsdom entirely.
const g = globalThis as Record<string, unknown>;
if (typeof g.TextEncoder === "undefined") g.TextEncoder = TextEncoder;
if (typeof g.TextDecoder === "undefined") g.TextDecoder = TextDecoder;

// Blob.arrayBuffer() / Blob.text() — jsdom implements FileReader but not these,
// so anything that reads bytes out of a File fails with "not a function".
// Implemented over FileReader so the bytes are real.
function readBlob(blob: Blob, as: "buffer" | "text"): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer | string);
    reader.onerror = () => reject(reader.error);
    if (as === "buffer") reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });
}

if (typeof Blob !== "undefined") {
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      writable: true,
      value(this: Blob) {
        return readBlob(this, "buffer") as Promise<ArrayBuffer>;
      },
    });
  }
  if (typeof Blob.prototype.text !== "function") {
    Object.defineProperty(Blob.prototype, "text", {
      configurable: true,
      writable: true,
      value(this: Blob) {
        return readBlob(this, "text") as Promise<string>;
      },
    });
  }
}
