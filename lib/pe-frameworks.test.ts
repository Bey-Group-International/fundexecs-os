import {
  classifyArtifact,
  frameworkFor,
  frameworkPromptFor,
  frameworkArtifactTypes,
} from "./pe-frameworks";

describe("classifyArtifact", () => {
  it("routes IC / recommendation titles to ic_memo", () => {
    expect(classifyArtifact("analyst", "Draft IC memo")).toBe("ic_memo");
    expect(classifyArtifact("associate", "Recommendation to committee")).toBe("ic_memo");
  });

  it("routes modeling titles to model", () => {
    expect(classifyArtifact("analyst", "Build the LBO model")).toBe("model");
    expect(classifyArtifact("analyst", "DCF valuation")).toBe("model");
    expect(classifyArtifact("associate", "Underwriting sensitivity")).toBe("model");
  });

  it("routes risk / diligence titles to risk_report", () => {
    expect(classifyArtifact("associate", "Key risks and red flags")).toBe("risk_report");
    expect(classifyArtifact("associate", "Diligence findings")).toBe("risk_report");
  });

  it("routes summary titles to summary", () => {
    expect(classifyArtifact("associate", "Synthesis of findings")).toBe("summary");
  });

  it("falls back to the agent's default type when the title is generic", () => {
    expect(classifyArtifact("analyst", "Next steps")).toBe("analysis");
    expect(classifyArtifact("diligence", "Next steps")).toBe("risk_report");
    expect(classifyArtifact("investor_relations", "Next steps")).toBe("lp_update");
    expect(classifyArtifact("fund_admin", "Next steps")).toBe("memo");
    expect(classifyArtifact("associate", "Next steps")).toBe("memo");
  });
});

describe("frameworkFor", () => {
  it("returns a structured framework for the four heavy deliverables", () => {
    for (const t of ["ic_memo", "lp_update", "risk_report", "model"] as const) {
      const fw = frameworkFor(t);
      expect(fw).not.toBeNull();
      expect(fw!.artifactType).toBe(t);
      expect(fw!.sections.length).toBeGreaterThan(0);
      expect(fw!.principles.length).toBeGreaterThan(0);
    }
  });

  it("returns null for lightweight artifact types", () => {
    expect(frameworkFor("memo")).toBeNull();
    expect(frameworkFor("summary")).toBeNull();
    expect(frameworkFor("analysis")).toBeNull();
    expect(frameworkFor("other")).toBeNull();
  });

  it("enumerates exactly the framework-bearing types", () => {
    expect(frameworkArtifactTypes().sort()).toEqual(
      ["ic_memo", "lp_update", "model", "risk_report"].sort(),
    );
  });
});

describe("frameworkPromptFor", () => {
  it("renders a numbered section skeleton and principles for a heavy type", () => {
    const prompt = frameworkPromptFor("ic_memo");
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("Investment Committee memo");
    expect(prompt).toContain("1. Recommendation");
    expect(prompt).toContain("Hold to these standards:");
    // Every section heading appears in the rendered prompt.
    for (const s of frameworkFor("ic_memo")!.sections) {
      expect(prompt).toContain(s.heading);
    }
  });

  it("returns null for a type with no framework, so the base prompt is untouched", () => {
    expect(frameworkPromptFor("memo")).toBeNull();
    expect(frameworkPromptFor("summary")).toBeNull();
  });

  it("leads with a double newline so it appends cleanly to a system prompt", () => {
    expect(frameworkPromptFor("lp_update")!.startsWith("\n\n")).toBe(true);
  });
});
