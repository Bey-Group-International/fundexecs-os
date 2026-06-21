import {
  TASK_GRAPH,
  TWIN_AGENTS,
  activeAgentCount,
  isAgentExecuting,
  nextTwinPhaseOnPrompt,
  taskNodeStatus,
} from "@/lib/private-market-workspace";

describe("private market workspace state machine", () => {
  it("activates from idle when a prompt is entered", () => {
    expect(nextTwinPhaseOnPrompt("idle", "Source LPs for the raise")).toBe("prompt");
    expect(nextTwinPhaseOnPrompt("idle", "   ")).toBe("idle");
    expect(nextTwinPhaseOnPrompt("planning", "follow up")).toBe("planning");
  });

  it("maps active executive count by session milestone", () => {
    expect(activeAgentCount("idle")).toBe(1);
    expect(activeAgentCount("prompt")).toBe(2);
    expect(activeAgentCount("planning")).toBe(4);
    expect(activeAgentCount("authorized")).toBe(TWIN_AGENTS.length);
    expect(activeAgentCount("executing")).toBe(TWIN_AGENTS.length);
    expect(activeAgentCount("complete")).toBe(1);
  });

  it("activates Earn first, then planning agents, then the full executive workforce", () => {
    expect(isAgentExecuting("idle", "Earn")).toBe(false);
    expect(isAgentExecuting("prompt", "Earn")).toBe(true);
    expect(isAgentExecuting("prompt", "Capital Agent")).toBe(false);
    expect(isAgentExecuting("planning", "Diligence Agent")).toBe(true);
    expect(isAgentExecuting("authorized", "Legal Agent")).toBe(true);
    expect(isAgentExecuting("executing", "Operations Agent")).toBe(true);
    expect(isAgentExecuting("complete", "Earn")).toBe(true);
    expect(isAgentExecuting("complete", "Deal Agent")).toBe(false);
  });

  it("advances task graph nodes as execution completes", () => {
    expect(taskNodeStatus("planning", 0)).toBe("pending");
    expect(taskNodeStatus("authorized", 0)).toBe("active");
    expect(taskNodeStatus("executing", 0)).toBe("complete");
    expect(taskNodeStatus("executing", 4)).toBe("active");
    expect(taskNodeStatus("executing", TASK_GRAPH.length - 1)).toBe("pending");
    expect(taskNodeStatus("complete", TASK_GRAPH.length - 1)).toBe("complete");
  });
});
