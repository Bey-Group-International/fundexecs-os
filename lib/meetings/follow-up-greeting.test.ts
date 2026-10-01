import {
  FIRST_NAME_TOKEN,
  displayFollowUp,
  firstNameOf,
  personalizeFollowUp,
} from "@/lib/meetings/follow-up-greeting";

describe("firstNameOf", () => {
  it("takes the given name", () => {
    expect(firstNameOf("Maria Chen")).toBe("Maria");
    expect(firstNameOf("Chen, Maria")).toBe("Maria");
  });

  it("has nothing to say for an address or a blank", () => {
    expect(firstNameOf("maria@fund.test")).toBe("");
    expect(firstNameOf("  ")).toBe("");
    expect(firstNameOf(null)).toBe("");
  });
});

describe("personalizeFollowUp", () => {
  const draft = `Hi ${FIRST_NAME_TOKEN},\n\nThanks for your time today.\n\nBest,\nAlex Rivera`;

  it("greets each recipient by their own first name", () => {
    expect(personalizeFollowUp(draft, "Jane Doe")).toMatch(/^Hi Jane,\n/);
    expect(personalizeFollowUp(draft, "Mark")).toMatch(/^Hi Mark,\n/);
  });

  it("falls back to 'there' when a recipient has no name", () => {
    expect(personalizeFollowUp(draft, "jane@fund.test")).toMatch(/^Hi there,\n/);
  });

  it("tolerates a hand-edited token", () => {
    expect(personalizeFollowUp("Dear {{ First_Name }},", "Jane Doe")).toBe("Dear Jane,");
  });

  // The bug this exists for: a stored draft written to the host, about to be
  // sent from the host's mailbox to everyone else.
  it("rewrites a greeting that names the host", () => {
    const legacy = "Hi Alex,\n\nThanks for your time today.";
    expect(personalizeFollowUp(legacy, "Jane Doe", { hostName: "Alex Rivera" })).toBe(
      "Hi Jane,\n\nThanks for your time today.",
    );
    expect(personalizeFollowUp("Dear Alex Rivera,\n\nHello", "Jane Doe", { hostName: "Alex Rivera" })).toBe(
      "Dear Jane,\n\nHello",
    );
  });

  it("reads a hyphenated name as one name", () => {
    expect(
      personalizeFollowUp("Hi Sam Lee-Park,\n\nThanks", "Jane", { hostName: "Sam Lee-Park" }),
    ).toBe("Hi Jane,\n\nThanks");
  });

  it("leaves the host's own wording alone when it does not name the host", () => {
    const own = "Hi all,\n\nGood meeting.";
    expect(personalizeFollowUp(own, "Jane", { hostName: "Alex Rivera" })).toBe(own);
    const named = "Hi Jane,\n\nGood meeting.";
    expect(personalizeFollowUp(named, "Mark", { hostName: "Alex Rivera" })).toBe(named);
  });

  it("changes nothing without a host name to compare against", () => {
    expect(personalizeFollowUp("Hi Alex,\n\nx", "Jane")).toBe("Hi Alex,\n\nx");
  });
});

describe("displayFollowUp", () => {
  it("shows the token as a placeholder rather than as template syntax", () => {
    expect(displayFollowUp(`Hi ${FIRST_NAME_TOKEN},`)).toBe("Hi [First name],");
  });
});
