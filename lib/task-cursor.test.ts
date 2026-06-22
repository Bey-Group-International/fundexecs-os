import { encodeCursor, decodeCursor } from "./task-cursor";

describe("task pagination cursor", () => {
  it("round-trips created_at and id", () => {
    const createdAt = "2026-06-22T01:22:19.123456+00:00";
    const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    const decoded = decodeCursor(encodeCursor(createdAt, id));
    expect(decoded).toEqual({ createdAt, id });
  });

  it("produces an opaque token (not the raw values)", () => {
    const token = encodeCursor("2026-06-22T01:22:19+00:00", "abc");
    expect(token).not.toContain("2026");
    expect(token).not.toContain("|");
  });

  it("preserves a created_at that itself contains the separator", () => {
    // lastIndexOf('|') splits on the final separator, so timestamps or ids
    // containing '|' still decode to the correct boundary.
    const createdAt = "weird|timestamp";
    const id = "task-1";
    expect(decodeCursor(encodeCursor(createdAt, id))).toEqual({ createdAt, id });
  });

  it("returns null for malformed cursors", () => {
    expect(decodeCursor("")).toBeNull();
    // base64url with no separator after decoding
    expect(decodeCursor(Buffer.from("nopipe").toString("base64url"))).toBeNull();
    // empty id half
    expect(decodeCursor(Buffer.from("2026-01-01|").toString("base64url"))).toBeNull();
    // empty created_at half
    expect(decodeCursor(Buffer.from("|abc").toString("base64url"))).toBeNull();
  });
});
