// Coverage for /api/meetings/analyze: previously authenticated via a raw
// supabase.auth.getUser() with no org resolution at all (so there was no
// orgId to gate spend against), and called Claude with zero cost metering.
// Now resolves org context via requireOrgContext and gates spend before
// calling analyzeMeeting.

const requireOrgContext = jest.fn();
jest.mock("@/lib/auth", () => ({ requireOrgContext: (...a: unknown[]) => requireOrgContext(...a) }));

const analyzeMeeting = jest.fn();
jest.mock("@/lib/claude", () => ({ analyzeMeeting: (...a: unknown[]) => analyzeMeeting(...a) }));

const gateConversationalSpend = jest.fn();
jest.mock("@/lib/conversational-gate", () => {
  const actual = jest.requireActual("@/lib/conversational-gate");
  return { ...actual, gateConversationalSpend: (...a: unknown[]) => gateConversationalSpend(...a) };
});

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/meetings/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "user-1" } });
  gateConversationalSpend.mockResolvedValue({ ok: true });
});

describe("POST /api/meetings/analyze", () => {
  it("rejects an unauthenticated/no-org request before gating or analyzing", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await POST(request({ transcript: "hello" }));
    expect(res.status).toBe(401);
    expect(gateConversationalSpend).not.toHaveBeenCalled();
    expect(analyzeMeeting).not.toHaveBeenCalled();
  });

  it("rejects a missing transcript before gating", async () => {
    const res = await POST(request({ title: "Sync" }));
    expect(res.status).toBe(400);
    expect(gateConversationalSpend).not.toHaveBeenCalled();
  });

  it("gates spend against the resolved org before calling analyzeMeeting", async () => {
    analyzeMeeting.mockResolvedValue({ summary: "ok" });
    await POST(request({ transcript: "Discussed terms." }));

    expect(gateConversationalSpend).toHaveBeenCalledWith("org-1", expect.any(Number), "meeting_analyze");
    expect(analyzeMeeting).toHaveBeenCalledTimes(1);
  });

  it("returns 402 and never calls analyzeMeeting when credits are insufficient", async () => {
    gateConversationalSpend.mockResolvedValue({ ok: false, status: 402, error: "Insufficient credits" });
    const res = await POST(request({ transcript: "Discussed terms." }));

    expect(res.status).toBe(402);
    expect(analyzeMeeting).not.toHaveBeenCalled();
  });
});
