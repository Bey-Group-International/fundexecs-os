import { DEFAULT_PAGE_RATIO, MAX_PAGE_WIDTH, pageBox, pageWidth } from "./pdf-layout";

describe("pageBox", () => {
  it("fits the container up to the widest a page is drawn", () => {
    expect(pageWidth(500)).toBe(500);
    expect(pageWidth(1400)).toBe(MAX_PAGE_WIDTH);
    expect(pageBox(1400, 1.5)).toEqual({ width: 900, height: 1350 });
  });
  it("uses the shape of the first page, so a long document does not jump as it loads", () => {
    expect(pageBox(600, 1.414)).toEqual({ width: 600, height: 848 });
  });
  it("falls back to US Letter for a missing or absurd shape", () => {
    const letter = Math.round(600 * DEFAULT_PAGE_RATIO);
    expect(pageBox(600).height).toBe(letter);
    expect(pageBox(600, NaN).height).toBe(letter);
    expect(pageBox(600, 0).height).toBe(letter);
    expect(pageBox(600, 40).height).toBe(letter);
  });
});
