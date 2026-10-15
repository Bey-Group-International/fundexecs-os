import { firstClusterOffset, startAtCluster } from "@/lib/meetings/webm-cluster";

/** `1F43B675`, an unknown-size field (what a live recorder writes), then the Timecode. */
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];

function bytes(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

const filler = (n: number, value = 0xa3) => Array.from({ length: n }, () => value);

describe("firstClusterOffset", () => {
  it("finds a cluster header after the tail of the previous cluster", () => {
    expect(firstClusterOffset(bytes(filler(40), CLUSTER, filler(10)))).toBe(40);
  });

  it("is zero when the part already begins at a cluster", () => {
    expect(firstClusterOffset(bytes(CLUSTER, filler(10)))).toBe(0);
  });

  it("is -1 when the part holds no cluster header at all", () => {
    expect(firstClusterOffset(bytes(filler(500)))).toBe(-1);
    expect(firstClusterOffset(new Uint8Array(0))).toBe(-1);
  });

  it("reads a known-size cluster as well as an unknown-size one", () => {
    // 4-byte size field: marker bit in the first byte's third position.
    const known = [0x1f, 0x43, 0xb6, 0x75, 0x10, 0x00, 0x04, 0x00, 0xe7, 0x81, 0x00];
    expect(firstClusterOffset(bytes(filler(7), known))).toBe(7);
  });

  // The four-byte ID can turn up inside compressed video. A header only counts
  // with a size field after it, and — preferably — the Timecode every cluster
  // opens with, so a stray match earlier in the part is not mistaken for one.
  it("passes over the ID where it is only part of the payload", () => {
    const stray = [0x1f, 0x43, 0xb6, 0x75, 0x00, 0x11, 0x22]; // size byte 0x00 is not a valid length
    expect(firstClusterOffset(bytes(filler(5), stray, filler(20), CLUSTER))).toBe(5 + stray.length + 20);
  });

  it("prefers a header with its Timecode over an earlier bare one", () => {
    const bare = [0x1f, 0x43, 0xb6, 0x75, 0x81, 0x11, 0x22, 0x33];
    expect(firstClusterOffset(bytes(filler(3), bare, filler(9), CLUSTER))).toBe(3 + bare.length + 9);
  });

  it("falls back to a bare header when no cluster opens with a Timecode", () => {
    const bare = [0x1f, 0x43, 0xb6, 0x75, 0x81, 0x11, 0x22, 0x33];
    expect(firstClusterOffset(bytes(filler(3), bare))).toBe(3);
  });

  it("does not run off the end when the ID is cut short", () => {
    expect(firstClusterOffset(bytes(filler(4), [0x1f, 0x43, 0xb6]))).toBe(-1);
    expect(firstClusterOffset(bytes(filler(4), [0x1f, 0x43, 0xb6, 0x75]))).toBe(-1);
  });
});

describe("startAtCluster", () => {
  it("returns the bytes from the header on, without copying them", () => {
    const input = bytes(filler(12), CLUSTER, filler(5));
    const out = startAtCluster(input)!;
    expect(out.byteLength).toBe(CLUSTER.length + 5);
    expect(out[0]).toBe(0x1f);
    expect(out.buffer).toBe(input.buffer);
  });

  it("is null when there is nothing to start from", () => {
    expect(startAtCluster(bytes(filler(64)))).toBeNull();
  });
});
