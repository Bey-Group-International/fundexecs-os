// The summary call, as the hourly batch makes it on a small model.
const create = jest.fn();
jest.mock("@/lib/anthropic-client", () => ({
  anthropicClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  isAnthropicTimeout: () => false,
}));

import { summarizeThread } from "./intelligence";

const INPUT = {
  subject: "Series B terms",
  category: "messaging" as const,
  counterparty: "Ana",
  messages: [{ direction: "inbound" as const, body: "Can you send the side letter?" }],
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  create.mockReset();
  create.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify({ summary: "Ana wants the side letter.", intent: "Requesting a document" }) }],
  });
});
afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

it("runs on the model it is given, without the effort field Haiku rejects", async () => {
  const r = await summarizeThread(INPUT, { model: "claude-haiku-4-5" });
  expect(r).toEqual({ summary: "Ana wants the side letter.", intent: "Requesting a document" });
  const params = create.mock.calls[0][0] as { model: string; output_config: Record<string, unknown> };
  expect(params.model).toBe("claude-haiku-4-5");
  expect(params.output_config.format).toMatchObject({ type: "json_schema" });
  expect(params.output_config).not.toHaveProperty("effort");
});

it("keeps low effort on a model that takes it", async () => {
  await summarizeThread(INPUT, { model: "claude-sonnet-4-6" });
  const params = create.mock.calls[0][0] as { output_config: Record<string, unknown> };
  expect(params.output_config.effort).toBe("low");
});
