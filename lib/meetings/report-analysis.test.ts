import { MEETING_REPORT_SCHEMA, reportPrompt } from "@/lib/meetings/report-analysis";
import { FALLBACK_QUESTION, OPEN_QUESTIONS_KEY } from "@/lib/meetings/report-gaps";

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

describe("generateMeetingReport's action items", () => {
  function clientReturning(input: Record<string, unknown>) {
    return {
      messages: {
        create: async () => ({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "meeting_report", input }],
        }),
      },
    } as never;
  }

  it("fills an empty list from the follow-up email the model wrote", async () => {
    const { generateMeetingReport } = await import("@/lib/meetings/report-analysis");
    const report = await generateMeetingReport(
      clientReturning({
        summary: "Agreed to proceed.",
        action_items: [],
        follow_up_draft: "Hi {{first_name}},\n\nAction items:\n1. Jane: send the deck\n2. Mark: book the call\n\nBest,\nAlex",
      }),
      "model",
      { ...base, host: { name: "Alex Rivera" } },
    );
    expect(report.action_items).toEqual(["Jane: send the deck", "Mark: book the call"]);
  });

  it("gives the host a closing step when there is nothing else", async () => {
    const { generateMeetingReport } = await import("@/lib/meetings/report-analysis");
    const report = await generateMeetingReport(
      clientReturning({ summary: "A short catch-up.", action_items: [], follow_up_draft: "Hi all" }),
      "model",
      { ...base, host: { name: "Alex Rivera" } },
    );
    expect(report.action_items).toEqual([
      "Alex Rivera: Send the follow-up and confirm next steps with everyone in the meeting",
    ]);
  });
});

describe("generateMeetingReport's gaps", () => {
  function clientReturning(input: Record<string, unknown>) {
    return {
      messages: {
        create: async () => ({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "meeting_report", input }],
        }),
      },
    } as never;
  }

  it("asks the model for open questions, and for decisions that are not disclaimers", () => {
    expect(MEETING_REPORT_SCHEMA.required).toContain(OPEN_QUESTIONS_KEY);
    expect(MEETING_REPORT_SCHEMA.properties.decisions.description).toMatch(/could not be confirmed/);
  });

  // The line this whole feature exists to remove.
  it("turns 'none could be confirmed' into a question for the host", async () => {
    const { generateMeetingReport } = await import("@/lib/meetings/report-analysis");
    const report = await generateMeetingReport(
      clientReturning({
        summary: "A short call.",
        action_items: ["Alex: Follow up"],
        decisions: ["None could be confirmed from the available recording due to audio quality issues."],
        follow_up_draft: "Hi {{first_name}},",
      }),
      "model",
      { ...base, host: { name: "Alex Rivera" } },
    );
    expect(report.decisions).toEqual([]);
    expect(report[OPEN_QUESTIONS_KEY]).toEqual([FALLBACK_QUESTION]);
  });

  it("keeps the model's own questions and its real decisions", async () => {
    const { generateMeetingReport } = await import("@/lib/meetings/report-analysis");
    const report = await generateMeetingReport(
      clientReturning({
        summary: "Agreed to proceed.",
        action_items: ["Alex: Follow up"],
        decisions: ["Proceed to diligence."],
        [OPEN_QUESTIONS_KEY]: ["Did Jane commit to the $10M re-up?"],
        follow_up_draft: "Hi {{first_name}},",
      }),
      "model",
      base,
    );
    expect(report.decisions).toEqual(["Proceed to diligence."]);
    expect(report[OPEN_QUESTIONS_KEY]).toEqual(["Did Jane commit to the $10M re-up?"]);
  });

  it("asks nothing of a clear transcript", async () => {
    const { generateMeetingReport } = await import("@/lib/meetings/report-analysis");
    const report = await generateMeetingReport(
      clientReturning({ summary: "Agreed.", action_items: ["Alex: Follow up"], decisions: ["Proceed."], follow_up_draft: "Hi" }),
      "model",
      base,
    );
    expect(report[OPEN_QUESTIONS_KEY]).toEqual([]);
  });
});

describe("the report's insight fields", () => {
  it("asks for highlights, unresolved questions, risks and an agenda, before the follow-up", () => {
    const required = MEETING_REPORT_SCHEMA.required as readonly string[];
    for (const key of ["highlights", "unresolved", "risks", "next_meeting_agenda"]) {
      expect(required).toContain(key);
    }
    // The follow-up is the longest field and stays last, so a report that runs
    // out of room loses it rather than everything after it.
    const keys = Object.keys(MEETING_REPORT_SCHEMA.properties);
    expect(keys[keys.length - 1]).toBe("follow_up_draft");
  });

  it("normalizes what the model returns for them", async () => {
    const { generateMeetingReport } = await import("@/lib/meetings/report-analysis");
    const client = {
      messages: {
        create: async () => ({
          stop_reason: "tool_use",
          content: [{
            type: "tool_use", id: "t", name: "meeting_report",
            input: {
              summary: "Agreed.",
              action_items: ["Jane: send the deck"],
              highlights: [{ point: "Terms agreed", quote: "\"forty pre\"" }, "Second"],
              unresolved: [{ owner: "Sam", question: "Who signs?" }],
              risks: ["Counsel may be late"],
              next_meeting_agenda: ["Side letter"],
            },
          }],
        }),
      },
    } as never;
    const report = await generateMeetingReport(client, "model", { title: "M", participants: [], transcript: "x" });
    expect(report.highlights).toEqual([{ point: "Terms agreed", quote: "forty pre" }, { point: "Second", quote: "" }]);
    expect(report.unresolved).toEqual(["Sam: Who signs?"]);
    expect(report.risks).toEqual(["Counsel may be late"]);
    expect(report.next_meeting_agenda).toEqual(["Side letter"]);
  });
});
