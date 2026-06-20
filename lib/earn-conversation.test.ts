import { attachmentSummary, buildEarnPromptEnvelope } from "@/lib/earn-conversation";

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
});
