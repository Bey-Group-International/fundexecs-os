import { classifyIntent } from "@/lib/intent";

describe("classifyIntent", () => {
  it("routes questions to a conversational answer", () => {
    expect(classifyIntent("What's a healthy DSCR for a stabilized multifamily deal?")).toBe("chat");
    expect(classifyIntent("How does a GP catch-up work?")).toBe("chat");
    expect(classifyIntent("Explain the waterfall to me")).toBe("chat");
  });

  it("routes explicit work requests to an agentic task", () => {
    expect(classifyIntent("Build an LBO model for the HVAC roll-up")).toBe("task");
    expect(classifyIntent("Source family offices in the Southeast")).toBe("task");
    expect(classifyIntent("Draft an LP update covering Q2 performance")).toBe("task");
  });

  it("treats short greetings and acknowledgements as chat", () => {
    expect(classifyIntent("hi")).toBe("chat");
    expect(classifyIntent("thanks, that helps")).toBe("chat");
    expect(classifyIntent("")).toBe("chat");
  });

  it("prefers chat when a work verb is phrased as a question", () => {
    expect(classifyIntent("Can you explain how you'd model this?")).toBe("chat");
  });
});
