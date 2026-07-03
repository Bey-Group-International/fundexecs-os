// Coverage for the shared enum/key humanizer (audit P1 #20 — raw DB enums
// like `fund_of_funds`, `ic_review`, `co_gp` were rendered verbatim to
// operators). The guard matters as much as the transform: real content
// (emails, URLs, names, sentences) must pass through untouched.
import { humanize, humanizeEnumValue } from "./humanize";

describe("humanize", () => {
  it("title-cases snake_case words", () => {
    expect(humanize("real_estate")).toBe("Real Estate");
    expect(humanize("pipeline_stage")).toBe("Pipeline Stage");
  });

  it("uppercases domain initialisms", () => {
    expect(humanize("ic_review")).toBe("IC Review");
    expect(humanize("co_gp")).toBe("Co GP");
    expect(humanize("lp")).toBe("LP");
    expect(humanize("nav_update")).toBe("NAV Update");
  });

  it("keeps connectives lowercase mid-phrase", () => {
    expect(humanize("fund_of_funds")).toBe("Fund of Funds");
    expect(humanize("terms_and_conditions")).toBe("Terms and Conditions");
  });

  it("capitalizes a leading connective", () => {
    expect(humanize("of_counsel")).toBe("Of Counsel");
  });
});

describe("humanizeEnumValue", () => {
  it("transforms enum-shaped values", () => {
    expect(humanizeEnumValue("capital_call")).toBe("Capital Call");
    expect(humanizeEnumValue("sourced")).toBe("Sourced");
  });

  it("passes real content through untouched", () => {
    expect(humanizeEnumValue("dana@lp.test")).toBe("dana@lp.test");
    expect(humanizeEnumValue("https://fund.example/deck")).toBe("https://fund.example/deck");
    expect(humanizeEnumValue("Fund of Funds")).toBe("Fund of Funds");
    expect(humanizeEnumValue("A note about the deal")).toBe("A note about the deal");
    expect(humanizeEnumValue("Acme Capital")).toBe("Acme Capital");
    expect(humanizeEnumValue("12500000")).toBe("12500000");
    expect(humanizeEnumValue("2026-07-03")).toBe("2026-07-03");
  });
});
