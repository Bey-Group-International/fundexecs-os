import { BRIEF_MAX, meetingBrief } from "./meeting-brief";

describe("meetingBrief", () => {
  it("labels each part and leaves out the empty ones", () => {
    expect(meetingBrief({ objective: "Agree the side letter", agenda: "", description: null })).toBe(
      "Objective: Agree the side letter",
    );
  });

  it("drops the stock line a booked meeting opens with, keeping the answers", () => {
    expect(
      meetingBrief({
        description: "Booked via scheduling link.\n\nNote from Jane: Which fund? Fund II\nCompany: Acme",
      }),
    ).toBe("Details:\nNote from Jane: Which fund? Fund II\nCompany: Acme");
  });

  it("is empty for a meeting with nothing written and for a bare booking", () => {
    expect(meetingBrief(null)).toBe("");
    expect(meetingBrief({ description: "Booked via scheduling link." })).toBe("");
  });

  it("stays inside its budget", () => {
    const out = meetingBrief({ agenda: "x".repeat(BRIEF_MAX * 2) });
    expect(out.length).toBeLessThanOrEqual(BRIEF_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});
