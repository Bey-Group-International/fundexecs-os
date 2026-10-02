jest.mock("server-only", () => ({}), { virtual: true });
const create = jest.fn();
jest.mock("@/lib/anthropic-client", () => ({
  anthropicClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  LONG_RUN_TIMEOUT_MS: 1,
}));

import { readEngagement } from "./data-room-engagement.server";
import { buildEngagement, type EngagementView } from "./data-room-engagement";

const now = new Date("2026-10-02T12:00:00Z").getTime();
const rows: EngagementView[] = [
  { share_id: "l", document_id: "ppm", kind: "document", action: "read", viewer_email: "a@x.com", session_id: "b1", duration_seconds: 1200, created_at: "2026-10-02T09:00:00Z" },
  { share_id: "l", document_id: "deck", kind: "document", action: "read", viewer_email: "b@x.com", session_id: "b2", duration_seconds: 30, created_at: "2026-10-02T09:00:00Z" },
];
const investors = buildEngagement(rows, new Map([["ppm", "PPM"], ["deck", "Deck"]]), new Map(), now).investors;
const ctx = { roomName: "Fund II", today: "2026-10-02" };

const reply = (reads: unknown[]) => ({ content: [{ type: "text", text: JSON.stringify({ reads }) }] });

afterEach(() => {
  create.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
});

it("uses the rules when Earn's model is not configured", async () => {
  const reads = await readEngagement(investors, ctx);
  expect(reads.map((r) => [r.key, r.signal, r.source])).toEqual([
    ["email:a@x.com", "hot", "rules"],
    ["email:b@x.com", "cold", "rules"],
  ]);
  expect(create).not.toHaveBeenCalled();
});

it("takes Earn's read, keeps the rules for anyone it skipped, and drops what it invented", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  create.mockResolvedValue(
    reply([
      { key: "email:a@x.com", signal: "hot", summary: "Deep in the PPM.", follow_up: "Offer a terms call." },
      { key: "email:ghost@x.com", signal: "hot", summary: "Made up.", follow_up: "None." },
    ]),
  );
  const reads = await readEngagement(investors, ctx);
  expect(reads).toEqual([
    { key: "email:a@x.com", signal: "hot", summary: "Deep in the PPM.", follow_up: "Offer a terms call.", source: "earn" },
    expect.objectContaining({ key: "email:b@x.com", source: "rules" }),
  ]);
  const prompt = create.mock.calls[0][0].messages[0].content as string;
  expect(prompt).toContain("PPM: read 20 min");
  expect(prompt).toContain("Room: Fund II");
});

it("falls back to the rules when the model call fails", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  create.mockRejectedValue(new Error("overloaded"));
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const reads = await readEngagement(investors, ctx);
  expect(reads.every((r) => r.source === "rules")).toBe(true);
});
