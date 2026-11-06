import {
  INTAKE_MAX_QUESTIONS,
  intakeIdFor,
  normalizeIntakeQuestions,
  notesWithIntake,
  validateIntakeAnswers,
} from "./intake";

describe("normalizeIntakeQuestions", () => {
  it("keeps well-formed questions and fills in what is missing", () => {
    expect(
      normalizeIntakeQuestions([
        { id: "fund", label: "Which fund?", kind: "short", required: true },
        { label: "Anything else", kind: "long" },
      ]),
    ).toEqual([
      { id: "fund", label: "Which fund?", kind: "short", options: [], required: true },
      { id: "anything-else", label: "Anything else", kind: "long", options: [], required: false },
    ]);
  });

  it("drops junk, unlabelled questions and anything past the cap", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `Q${i}` }));
    expect(normalizeIntakeQuestions("nope")).toEqual([]);
    expect(normalizeIntakeQuestions([null, 3, { label: "  " }, ["x"]])).toEqual([]);
    expect(normalizeIntakeQuestions(many)).toHaveLength(INTAKE_MAX_QUESTIONS);
  });

  it("asks a choice with fewer than two distinct options as a short answer", () => {
    const [q] = normalizeIntakeQuestions([{ label: "Role", kind: "choice", options: ["LP", "lp", " "] }]);
    expect(q.kind).toBe("short");
    expect(q.options).toEqual([]);
  });

  it("keeps a choice's distinct options, trimmed", () => {
    const [q] = normalizeIntakeQuestions([{ label: "Role", kind: "choice", options: [" LP ", "GP", "lp"] }]);
    expect(q.options).toEqual(["LP", "GP"]);
  });

  it("makes duplicate ids unique and strips line breaks from labels", () => {
    const qs = normalizeIntakeQuestions([
      { id: "a", label: "One\nline" },
      { id: "a", label: "Two" },
    ]);
    expect(qs.map((q) => q.id)).toEqual(["a", "two"]);
    expect(qs[0].label).toBe("One line");
  });
});

describe("intakeIdFor", () => {
  it("slugs the label and avoids taken ids", () => {
    expect(intakeIdFor("Company or fund?", new Set())).toBe("company-or-fund");
    expect(intakeIdFor("Company", new Set(["company"]))).toBe("company-2");
    expect(intakeIdFor("???", new Set())).toBe("q");
  });
});

describe("validateIntakeAnswers", () => {
  const questions = normalizeIntakeQuestions([
    { id: "fund", label: "Which fund?", kind: "short", required: true },
    { id: "role", label: "Role", kind: "choice", options: ["LP", "GP"] },
    { id: "more", label: "Context", kind: "long" },
  ]);

  it("returns answers in question order and leaves blanks out", () => {
    const out = validateIntakeAnswers(questions, { more: "Line one\nLine two", fund: " Fund II ", role: "" });
    expect(out.errors).toEqual({});
    expect(out.answers).toEqual([
      { label: "Which fund?", answer: "Fund II" },
      { label: "Context", answer: "Line one\nLine two" },
    ]);
  });

  it("requires a required answer", () => {
    expect(validateIntakeAnswers(questions, {}).errors).toEqual({ fund: "Please answer this." });
    expect(validateIntakeAnswers(questions, "garbage").errors).toEqual({ fund: "Please answer this." });
  });

  it("only takes a listed choice, matched without case", () => {
    expect(validateIntakeAnswers(questions, { fund: "x", role: "Founder" }).errors.role).toBe("Pick one of the options.");
    expect(validateIntakeAnswers(questions, { fund: "x", role: "gp" }).answers[1]).toEqual({ label: "Role", answer: "GP" });
  });

  it("caps an answer's length", () => {
    expect(validateIntakeAnswers(questions, { fund: "x".repeat(201) }).errors.fund).toMatch(/under 200/);
  });

  it("flattens a short answer to one line", () => {
    expect(validateIntakeAnswers(questions, { fund: "Fund\nII" }).answers[0].answer).toBe("Fund II");
  });
});

describe("notesWithIntake", () => {
  it("puts the answers before the free notes", () => {
    expect(
      notesWithIntake(
        [
          { label: "Which fund?", answer: "Fund II" },
          { label: "Company", answer: "Acme" },
        ],
        "See you then",
      ),
    ).toBe("Which fund? Fund II\nCompany: Acme\n\nSee you then");
  });

  it("indents a multi-line answer under its question", () => {
    expect(notesWithIntake([{ label: "Context", answer: "One\nTwo" }], "")).toBe("Context: One\n  Two");
  });

  it("is the notes alone with no answers, and null with neither", () => {
    expect(notesWithIntake([], " hi ")).toBe("hi");
    expect(notesWithIntake([], null)).toBeNull();
  });
});
