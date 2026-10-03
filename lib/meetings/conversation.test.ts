import {
  conversationProblem,
  conversationTemplate,
  firstName,
  FIRST_NAME_TOKEN,
  groupTemplate,
  personalizeGroupBody,
  TEMPLATE_ACTION_ITEMS,
} from "./conversation";

describe("conversationTemplate", () => {
  it("greets by first name and carries the meeting's action items", () => {
    const t = conversationTemplate({
      meetingTitle: "Series B sync",
      recipientName: "Ana Lopez",
      actionItems: ["Send the model", "  Book diligence  call "],
    });
    expect(t.subject).toBe("Series B sync");
    expect(t.body).toContain("Hi Ana,");
    expect(t.body).toContain("Thanks again for your time in Series B sync.");
    expect(t.body).toContain("- Send the model\n- Book diligence call");
  });

  it("stays sensible with no title, no name and no action items", () => {
    const t = conversationTemplate({ meetingTitle: null, recipientName: "ana@acme.com", actionItems: [] });
    expect(t.subject).toBe("Following up");
    expect(t.body.startsWith("Hi,\n")).toBe(true);
    expect(t.body).toContain("our meeting");
    expect(t.body).not.toContain("Picking up");
  });

  it("bounds the action items it lists", () => {
    const items = Array.from({ length: TEMPLATE_ACTION_ITEMS + 3 }, (_, i) => `Item ${i}`);
    const t = conversationTemplate({ meetingTitle: "X", recipientName: "A", actionItems: items });
    expect(t.body.match(/^- /gm)).toHaveLength(TEMPLATE_ACTION_ITEMS);
  });
});

describe("helpers", () => {
  it("reads a first name, never an address", () => {
    expect(firstName("Ana Lopez")).toBe("Ana");
    expect(firstName("ana@acme.com")).toBe("");
  });
  it("names what a send is missing", () => {
    expect(conversationProblem({ subject: "", body: "x" })).toBe("Add a subject.");
    expect(conversationProblem({ subject: "s", body: "  " })).toBe("Write a message first.");
    expect(conversationProblem({ subject: "s", body: "b" })).toBeNull();
  });
});

describe("group messages", () => {
  it("writes the greeting once with a first-name token, filled per person", () => {
    const t = groupTemplate({ meetingTitle: "IC prep", actionItems: [] });
    expect(t.body.startsWith(`Hi ${FIRST_NAME_TOKEN},`)).toBe(true);
    expect(personalizeGroupBody(t.body, "Ana Lopez").startsWith("Hi Ana,")).toBe(true);
    expect(personalizeGroupBody(t.body, "bo@x.io").startsWith("Hi,")).toBe(true);
  });
});
