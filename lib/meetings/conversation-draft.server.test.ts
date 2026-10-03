const create = jest.fn();
jest.mock("@/lib/anthropic-client", () => ({
  anthropicClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  isAnthropicTimeout: () => false,
}));

import { draftMeetingConversation, CONVERSATION_DRAFT_MODEL } from "./conversation-draft.server";

const INPUT = {
  meetingTitle: "Series B sync",
  recipientName: "Ana Lopez",
  summary: "Agreed terms in principle.",
  decisions: ["Proceed to IC"],
  actionItems: ["Send the model"],
};

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "test";
});
afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

it("drafts on the small model from the report record, without effort", async () => {
  create.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify({ subject: "Next steps on the Series B", body: "Hi Ana, …" }) }],
  });
  const r = await draftMeetingConversation(INPUT);
  expect(r).toEqual({ subject: "Next steps on the Series B", body: "Hi Ana, …", live: true });
  const params = create.mock.calls[0][0] as { model: string; output_config: Record<string, unknown>; messages: Array<{ content: string }> };
  expect(params.model).toBe(CONVERSATION_DRAFT_MODEL);
  expect(params.output_config).not.toHaveProperty("effort");
  expect(params.messages[0].content).toContain("Agreed terms in principle.");
  expect(params.messages[0].content).toContain("- Send the model");
});

it("falls back to the template when the model fails or answers badly", async () => {
  create.mockRejectedValueOnce(new Error("down"));
  const failed = await draftMeetingConversation(INPUT);
  expect(failed.live).toBe(false);
  expect(failed.body).toContain("Hi Ana,");

  create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ subject: "", body: "" }) }] });
  expect((await draftMeetingConversation(INPUT)).live).toBe(false);
});

it("makes no call without a key", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await draftMeetingConversation(INPUT);
  expect(r.live).toBe(false);
  expect(create).not.toHaveBeenCalled();
});
