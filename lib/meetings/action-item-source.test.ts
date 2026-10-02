import {
  actionItemsFromFollowUp,
  ensureActionItems,
  reportActionItems,
} from "@/lib/meetings/action-item-source";

const EMAIL = `Hi {{first_name}},

Thanks for your time today.

Decisions made:
- Proceed to diligence
- Cap co-invest at 15%

Action items:
1. Priya: Circulate the redlined side letter by Friday
2. **Alex** — Book the LPAC call

3. Marcus: Confirm wire instructions

Let's reconvene next Thursday.

Best,
Alex`;

describe("actionItemsFromFollowUp", () => {
  it("reads the numbered list under the Action items heading, and nothing else", () => {
    expect(actionItemsFromFollowUp(EMAIL)).toEqual([
      "Priya: Circulate the redlined side letter by Friday",
      "Alex: Book the LPAC call",
      "Marcus: Confirm wire instructions",
    ]);
  });

  it("accepts a Next steps heading and bullets", () => {
    expect(actionItemsFromFollowUp("Recap.\n\nNext steps:\n- Jane: send the deck\n• Mark: book the room\n\nThanks")).toEqual([
      "Jane: send the deck",
      "Mark: book the room",
    ]);
  });

  it("does not mistake a list of decisions for commitments", () => {
    expect(actionItemsFromFollowUp("Decisions made:\n- Proceed\n- Cap at 15%")).toEqual([]);
  });

  it("is empty for an email with no such section, or no email", () => {
    expect(actionItemsFromFollowUp("Hi all,\n\nGreat meeting.")).toEqual([]);
    expect(actionItemsFromFollowUp(null)).toEqual([]);
  });
});

describe("reportActionItems", () => {
  it("prefers the report's own list", () => {
    expect(reportActionItems(["Jane: send deck"], { follow_up_draft: EMAIL })).toEqual(["Jane: send deck"]);
  });

  it("falls back to the follow-up's list when the report's is empty", () => {
    expect(reportActionItems([], { follow_up_draft: EMAIL })).toHaveLength(3);
  });
});

describe("ensureActionItems", () => {
  it("never leaves a summarised meeting without one", () => {
    expect(ensureActionItems({ summary: "We talked.", action_items: [], follow_up_draft: "Hi all" }, "Alex Rivera")).toEqual([
      "Alex Rivera: Send the follow-up and confirm next steps with everyone in the meeting",
    ]);
  });

  it("uses the follow-up's items before inventing one", () => {
    expect(ensureActionItems({ summary: "x", action_items: [], follow_up_draft: EMAIL }, "Alex")).toHaveLength(3);
  });

  it("invents nothing for a failed analysis", () => {
    expect(ensureActionItems({ summary: "", action_items: [] }, "Alex")).toEqual([]);
  });
});
