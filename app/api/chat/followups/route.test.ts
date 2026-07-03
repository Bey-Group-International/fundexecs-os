// Coverage for /api/chat/followups' credit-gate integration: this route's own
// design is "advisory — returns an empty list rather than erroring", so
// insufficient credits should degrade the same way (empty suggestions, no
// error surfaced), not hard-fail like /api/chat's main reply does.

const requireOrgContext = jest.fn();
jest.mock("@/lib/auth", () => ({ requireOrgContext: (...a: unknown[]) => requireOrgContext(...a) }));

const earnFollowups = jest.fn();
jest.mock("@/lib/claude", () => ({ earnFollowups: (...a: unknown[]) => earnFollowups(...a) }));

const gateConversationalSpend = jest.fn();
jest.mock("@/lib/conversational-gate", () => {
  const actual = jest.requireActual("@/lib/conversational-gate");
  return { ...actual, gateConversationalSpend: (...a: unknown[]) => gateConversationalSpend(...a) };
});

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/chat/followups", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "user-1" } });
  gateConversationalSpend.mockResolvedValue({ ok: true });
});

describe("POST /api/chat/followups", () => {
  it("returns suggestions when the gate passes", async () => {
    earnFollowups.mockResolvedValue(["Tell me more", "What's the risk?"]);
    const res = await POST(request({ body: "hi", reply: "here's an answer" }));
    const json = await res.json();
    expect(json.suggestions).toEqual(["Tell me more", "What's the risk?"]);
  });

  it("degrades to an empty list (no error) when credits are insufficient, and never calls Claude", async () => {
    gateConversationalSpend.mockResolvedValue({ ok: false, status: 402, error: "Insufficient credits" });
    const res = await POST(request({ body: "hi", reply: "here's an answer" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ suggestions: [] });
    expect(earnFollowups).not.toHaveBeenCalled();
  });
});
