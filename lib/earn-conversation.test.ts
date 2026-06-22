import {
  attachmentSummary,
  buildEarnPromptEnvelope,
  DEFAULT_EARN_MODEL,
  EARN_MODELS,
} from "@/lib/earn-conversation";

describe("attachmentSummary", () => {
  it("formats image and video attachment metadata", () => {
    expect(
      attachmentSummary([
        { name: "deck.png", type: "image/png", size: 2048 },
        { name: "walkthrough.mp4", type: "video/mp4", size: 2_500_000 },
      ]),
    ).toBe("deck.png (image/png, 2 KB); walkthrough.mp4 (video/mp4, 2.4 MB)");
  });
});

describe("buildEarnPromptEnvelope", () => {
  it("preserves the body and adds model, voice, and attachment metadata", () => {
    const out = buildEarnPromptEnvelope({
      body: "Build an IC memo.",
      model: "gemini",
      voiceUsed: true,
      attachments: [{ name: "site-tour.mov", type: "video/quicktime", size: 1024 }],
    });

    expect(out).toContain("Selected reasoning engine: Gemini");
    expect(out).toContain("voice transcript");
    expect(out).toContain("site-tour.mov");
    expect(out.endsWith("Build an IC memo.")).toBe(true);
  });

  it("defaults to Earn as the house reasoning engine", () => {
    expect(DEFAULT_EARN_MODEL).toBe("earn");
    expect(EARN_MODELS.find((m) => m.key === "earn")?.default).toBe(true);
  });

  it("carries the chosen operator mode directive and defaults to Accept edits", () => {
    const planned = buildEarnPromptEnvelope({
      body: "Source family offices.",
      model: "earn",
      mode: "plan",
      attachments: [],
    });
    expect(planned).toContain("Operator mode: Plan Mode");

    const defaulted = buildEarnPromptEnvelope({
      body: "Source family offices.",
      model: "earn",
      attachments: [],
    });
    expect(defaulted).toContain("Operator mode: Accept edits");
  });
});
