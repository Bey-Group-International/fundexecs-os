import { FALLBACK_QUESTION, answersAsCorrection, isGapDisclaimer, reportGaps } from "./report-gaps";

describe("isGapDisclaimer", () => {
  it("recognises the line this exists to remove", () => {
    expect(isGapDisclaimer("None could be confirmed from the available recording due to audio quality issues.")).toBe(true);
  });

  it.each([
    "No decisions could be determined from the transcript.",
    "Unable to confirm any decisions; the audio was poor.",
    "Portions of the recording were inaudible.",
    "No clear decisions were reached.",
    "The transcript was incomplete.",
  ])("recognises %j", (line) => {
    expect(isGapDisclaimer(line)).toBe(true);
  });

  it("leaves real decisions alone, including ones about audio", () => {
    expect(isGapDisclaimer("Proceed to term sheet at a $25M pre-money valuation.")).toBe(false);
    expect(isGapDisclaimer("Buy new conference-room microphones before the LP day.")).toBe(false);
    expect(isGapDisclaimer("Jane confirmed the re-up at $10M.")).toBe(false);
    expect(isGapDisclaimer("")).toBe(false);
  });
});

describe("reportGaps", () => {
  it("drops the disclaimer and asks the host instead", () => {
    const gaps = reportGaps({
      decisions: ["None could be confirmed from the available recording due to audio quality issues."],
    });
    expect(gaps.decisions).toEqual([]);
    expect(gaps.openQuestions).toEqual([FALLBACK_QUESTION]);
  });

  it("keeps the model's own questions when it asked some", () => {
    const gaps = reportGaps({
      decisions: ["Proceed to diligence.", "Decisions could not be confirmed after minute 20."],
      open_questions: ["Did Jane agree to the $10M re-up, or only to review the terms?"],
    });
    expect(gaps.decisions).toEqual(["Proceed to diligence."]);
    expect(gaps.openQuestions).toEqual(["Did Jane agree to the $10M re-up, or only to review the terms?"]);
  });

  it("asks nothing when nothing was dropped and nothing was asked", () => {
    expect(reportGaps({ decisions: ["Proceed."] })).toEqual({ decisions: ["Proceed."], openQuestions: [] });
    expect(reportGaps({})).toEqual({ decisions: [], openQuestions: [] });
  });

  it("coerces model output that is not a list of strings", () => {
    const gaps = reportGaps({ decisions: "Proceed.", open_questions: [{ text: "Who owns the deck?" }] });
    expect(gaps.decisions).toEqual(["Proceed."]);
    expect(gaps.openQuestions).toHaveLength(1);
  });
});

describe("answersAsCorrection", () => {
  it("pairs each answer with its question and leaves unanswered ones out", () => {
    expect(
      answersAsCorrection([
        { question: "What was decided on the re-up?", answer: "Jane committed $10M." },
        { question: "Who owns the deck?", answer: "  " },
        { question: "When do you reconvene?", answer: "Next Thursday." },
      ]),
    ).toBe("Q: What was decided on the re-up?\nA: Jane committed $10M.\n\nQ: When do you reconvene?\nA: Next Thursday.");
  });

  it("is empty when nothing was answered", () => {
    expect(answersAsCorrection([{ question: "Q?", answer: "" }])).toBe("");
  });
});
