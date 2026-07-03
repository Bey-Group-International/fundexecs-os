import { encodeCursor, decodeCursor, pgLiteral, clampLimit } from "./api-v1-cursor";

describe("api-v1 pagination cursor", () => {
  it("round-trips a string sort value and id", () => {
    const cursor = { v: "2026-06-22T01:22:19.123456+00:00", id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips a null sort value (the nullable-column tail)", () => {
    const cursor = { v: null, id: "fund-1" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips free text containing characters PostgREST's filter grammar treats as structural", () => {
    const cursor = { v: 'Smith, Jones & Co. (Fund II) "Alpha"', id: "inv-1" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("produces an opaque token (not the raw values)", () => {
    const token = encodeCursor({ v: "2026-06-22T01:22:19+00:00", id: "abc" });
    expect(token).not.toContain("2026");
  });

  it("returns null for malformed cursors", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(Buffer.from("not json").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: "x" })).toString("base64url"))).toBeNull(); // missing id
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: "x", id: "" })).toString("base64url"))).toBeNull(); // empty id
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 5, id: "a" })).toString("base64url"))).toBeNull(); // v must be string|null
    expect(decodeCursor(Buffer.from(JSON.stringify(["not", "an", "object"])).toString("base64url"))).toBeNull();
  });
});

describe("pgLiteral", () => {
  it("wraps a plain value in double quotes", () => {
    expect(pgLiteral("Acme Capital")).toBe('"Acme Capital"');
  });

  it("escapes embedded double quotes and backslashes", () => {
    expect(pgLiteral('Say "hi"')).toBe('"Say \\"hi\\""');
    expect(pgLiteral("back\\slash")).toBe('"back\\\\slash"');
  });

  it("makes PostgREST-structural characters (, . ( )) safe to embed", () => {
    const value = "Smith, Jones & Co. (Fund II)";
    const literal = pgLiteral(value);
    expect(literal.startsWith('"')).toBe(true);
    expect(literal.endsWith('"')).toBe(true);
    expect(literal.slice(1, -1)).toBe(value);
  });
});

describe("clampLimit", () => {
  it("defaults to 50 when absent", () => {
    expect(clampLimit(null)).toBe(50);
  });

  it("defaults when non-numeric", () => {
    expect(clampLimit("not-a-number")).toBe(50);
  });

  it("clamps to the max (200) when above it", () => {
    expect(clampLimit("10000")).toBe(200);
  });

  it("clamps to 1 when zero or negative", () => {
    expect(clampLimit("0")).toBe(1);
    expect(clampLimit("-5")).toBe(1);
  });

  it("passes through a valid value within range", () => {
    expect(clampLimit("75")).toBe(75);
  });
});
