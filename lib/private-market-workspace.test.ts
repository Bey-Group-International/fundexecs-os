import {
  HQ_AGENTS,
  activeAgentCount,
  isAgentMoving,
  nextHQStateOnPrompt,
} from "@/lib/private-market-workspace";

describe("private market workspace state machine", () => {
  it("activates from idle when a prompt is entered", () => {
    expect(nextHQStateOnPrompt("idle", "Source LPs for the raise")).toBe("activated");
    expect(nextHQStateOnPrompt("idle", "   ")).toBe("idle");
    expect(nextHQStateOnPrompt("semiActive", "follow up")).toBe("semiActive");
  });

  it("maps active executive count by session milestone", () => {
    expect(activeAgentCount("idle")).toBe(0);
    expect(activeAgentCount("activated")).toBe(1);
    expect(activeAgentCount("semiActive")).toBe(3);
    expect(activeAgentCount("fullyActive")).toBe(HQ_AGENTS.length);
  });

  it("moves Earn first, then assisting offices, then the whole team", () => {
    expect(isAgentMoving("idle", "Earn")).toBe(false);
    expect(isAgentMoving("activated", "Earn")).toBe(true);
    expect(isAgentMoving("activated", "Mara Chen")).toBe(false);
    expect(isAgentMoving("semiActive", "Darius Vale")).toBe(true);
    expect(isAgentMoving("fullyActive", "Nadia Cross")).toBe(true);
  });
});
