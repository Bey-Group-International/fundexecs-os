import { reportPrompt } from "@/lib/meetings/report-analysis";

const base = { title: "LP Update", participants: ["You", "Jane Doe"], transcript: "You: hello\nJane Doe: hi" };

describe("reportPrompt", () => {
  // The follow-up used to be addressed to whoever the participant list started
  // with — the host. The prompt now says who sends it and who receives it.
  it("names the host as the sender and the invitees as recipients", () => {
    const prompt = reportPrompt({
      ...base,
      host: { name: "Alex Rivera", email: "alex@fund.test" },
      recipients: [{ name: "Jane Doe", email: "jane@lp.test" }, { name: "Guest" }],
    });
    expect(prompt).toContain("Host (sends the follow-up; never its recipient): Alex Rivera <alex@fund.test>");
    expect(prompt).toContain("Follow-up recipients: Jane Doe <jane@lp.test>; Guest");
  });

  it("says nothing about roles it does not know", () => {
    const prompt = reportPrompt(base);
    expect(prompt).not.toContain("Host (");
    expect(prompt).not.toContain("Follow-up recipients");
  });

  it("puts the host's correction, and the version it corrects, ahead of the transcript", () => {
    const prompt = reportPrompt({
      ...base,
      correction: "The follow-up is to Jane, not me.",
      previous: { summary: "Old summary", followUp: "Hi Alex," },
    });
    const correctionAt = prompt.indexOf("HOST CORRECTIONS");
    expect(correctionAt).toBeGreaterThan(-1);
    expect(prompt).toContain("The follow-up is to Jane, not me.");
    expect(prompt).toContain("Follow-up draft:\nHi Alex,");
    expect(correctionAt).toBeLessThan(prompt.indexOf("FULL TRANSCRIPT"));
  });

  it("leaves the previous version out when there is no correction", () => {
    const prompt = reportPrompt({ ...base, previous: { summary: "Old summary" } });
    expect(prompt).not.toContain("PREVIOUS VERSION");
    expect(prompt).not.toContain("Old summary");
  });
});
