import { MAX_BIO_LENGTH, normalizeBio } from "./member-profile";

describe("normalizeBio", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeBio("  Runs the real estate book.  ")).toBe("Runs the real estate book.");
  });

  it("returns null for an empty bio so the column stays null", () => {
    expect(normalizeBio("")).toBeNull();
    expect(normalizeBio("   \n\n  ")).toBeNull();
    expect(normalizeBio(null)).toBeNull();
    expect(normalizeBio(undefined)).toBeNull();
  });

  it("collapses the blank-line runs a paste from a deck carries", () => {
    expect(normalizeBio("First line.\n\n\n\n\nSecond line.")).toBe("First line.\n\nSecond line.");
    expect(normalizeBio("First.\r\n\r\n\r\nSecond.")).toBe("First.\n\nSecond.");
  });

  it("keeps a single intentional paragraph break", () => {
    expect(normalizeBio("First.\n\nSecond.")).toBe("First.\n\nSecond.");
  });

  it("clamps an over-long bio to the documented ceiling", () => {
    const long = "x".repeat(MAX_BIO_LENGTH + 250);
    expect(normalizeBio(long)).toHaveLength(MAX_BIO_LENGTH);
  });

  it("leaves a bio at exactly the ceiling untouched", () => {
    const exact = "y".repeat(MAX_BIO_LENGTH);
    expect(normalizeBio(exact)).toBe(exact);
  });
});
