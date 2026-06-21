import {
  TASK_GRAPH,
  TWIN_AGENTS,
  TWIN_DISTRICTS,
} from "@/lib/private-market-workspace";

describe("private market workspace catalog", () => {
  it("keeps Earn as the central executive agent", () => {
    expect(TWIN_AGENTS[0]).toMatchObject({
      name: "Earn",
      title: "Chief Executive Agent",
      district: "Executive Operations Center",
    });
    expect(TWIN_AGENTS[0].x).toBe(50);
    expect(TWIN_AGENTS[0].y).toBe(48);
  });

  it("assigns each non-Earn agent to a workspace district", () => {
    const districtNames = new Set(TWIN_DISTRICTS.map((district) => district.name));
    for (const agent of TWIN_AGENTS.slice(1)) {
      expect(districtNames.has(agent.district)).toBe(true);
    }
  });

  it("keeps task graph nodes assigned to known agents", () => {
    const agentNames = new Set(TWIN_AGENTS.map((agent) => agent.name));
    for (const node of TASK_GRAPH) {
      expect(agentNames.has(node.agent)).toBe(true);
    }
  });

  it("preserves the seven-step private-market task graph", () => {
    expect(TASK_GRAPH.map((node) => node.title)).toEqual([
      "Source Targets",
      "Build Outreach List",
      "Qualify Opportunities",
      "Analyze Financials",
      "Build CIM Review",
      "Prepare Financing Package",
      "Generate Investor Updates",
    ]);
  });
});
