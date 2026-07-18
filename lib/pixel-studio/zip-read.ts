/**
 * Minimal ZIP reader for STORE-method archives produced by ./zip.ts. Parses
 * local file headers sequentially. Used by validators and the import path.
 */
export interface ReadZipEntry {
  path: string;
  data: Uint8Array;
}

export function listZip(bytes: Uint8Array): ReadZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: ReadZipEntry[] = [];
  let p = 0;
  while (p + 4 <= bytes.length) {
    const sig = view.getUint32(p, true);
    if (sig !== 0x04034b50) break; // reached central directory
    const method = view.getUint16(p + 8, true);
    const compSize = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const nameStart = p + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (method !== 0) {
      // We only write STORE; ignore compressed entries rather than mis-parse.
      entries.push({ path: name, data: new Uint8Array(0) });
    } else {
      entries.push({ path: name, data });
    }
    p = dataStart + compSize;
  }
  return entries;
}
