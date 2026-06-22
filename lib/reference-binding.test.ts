import { shouldReuseRecord } from "@/lib/reference-binding";

describe("shouldReuseRecord", () => {
  const existingName = "Cedar Ridge Multifamily";

  it("reuses on a noun-anchored reference phrase", () => {
    expect(
      shouldReuseRecord({ promptText: "Update the deal with the new target amount", existingName }),
    ).toBe(true);
    expect(shouldReuseRecord({ promptText: "Revise our model for the downside", existingName })).toBe(true);
    expect(shouldReuseRecord({ promptText: "Re-run the same investment with 6% rates", existingName })).toBe(true);
    expect(shouldReuseRecord({ promptText: "Stress this asset's exit assumptions", existingName })).toBe(true);
  });

  it("reuses on a standalone continuation cue", () => {
    expect(shouldReuseRecord({ promptText: "Refine the projections", existingName })).toBe(true);
    expect(shouldReuseRecord({ promptText: "Now adjust the leverage", existingName })).toBe(true);
    expect(shouldReuseRecord({ promptText: "Tighten it up and re-summarize", existingName })).toBe(true);
    expect(shouldReuseRecord({ promptText: "Take the above and add sensitivities", existingName })).toBe(true);
  });

  it("reuses when the extracted name matches the existing record", () => {
    expect(
      shouldReuseRecord({ promptText: "Build a model", existingName, extractedName: "Cedar Ridge Multifamily" }),
    ).toBe(true);
    // case-insensitive
    expect(
      shouldReuseRecord({ promptText: "Build a model", existingName, extractedName: "cedar ridge multifamily" }),
    ).toBe(true);
    // containment (extracted is a shorter form of the existing name)
    expect(
      shouldReuseRecord({ promptText: "Build a model", existingName, extractedName: "Cedar Ridge" }),
    ).toBe(true);
  });

  it("creates a new record for a genuinely different request", () => {
    expect(
      shouldReuseRecord({
        promptText: "Source a new industrial portfolio in Dallas",
        existingName,
        extractedName: "Dallas Logistics Portfolio",
      }),
    ).toBe(false);
    expect(
      shouldReuseRecord({ promptText: "Underwrite an office tower acquisition", existingName }),
    ).toBe(false);
  });

  it("never reuses when there is no existing record to bind to", () => {
    expect(shouldReuseRecord({ promptText: "Update the deal", existingName: "" })).toBe(false);
    expect(shouldReuseRecord({ promptText: "Update the deal", existingName: null })).toBe(false);
    expect(shouldReuseRecord({ promptText: "Update the deal" })).toBe(false);
  });

  it("does not match the pronoun cue inside a larger word", () => {
    // "items" contains "it" but should not trigger a reuse on its own.
    expect(shouldReuseRecord({ promptText: "List items for the new vendor", existingName })).toBe(false);
  });

  it("ignores an empty extracted name (no spurious containment match)", () => {
    expect(shouldReuseRecord({ promptText: "Build a model", existingName, extractedName: "" })).toBe(false);
    expect(shouldReuseRecord({ promptText: "Build a model", existingName, extractedName: null })).toBe(false);
  });
});
