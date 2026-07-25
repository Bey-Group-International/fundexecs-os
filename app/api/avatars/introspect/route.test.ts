const completeMock = jest.fn();
const brainsLiveMock = jest.fn();
const getUserMock = jest.fn();
const membersMock = jest.fn();

jest.mock("@/lib/brains/llm", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  brainsLive: () => brainsLiveMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: () => getUserMock() },
    from: () => ({
      select: () => ({ in: () => ({ limit: () => membersMock() }) }),
    }),
  }),
}));

import { POST } from "./route";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";

const SECRET = "test-ingest-secret";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/avatars/introspect", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const authed = { authorization: `Bearer ${SECRET}` };
const validBody = { avatar: "rm", behavior: "work_at_desk", goal: "core_work", mood: "focused", zone: "trading_floor", nearby: ["ir"] };

beforeEach(() => {
  jest.clearAllMocks();
  clearRateLimitBucketsForTests();
  process.env.BRAIN_INGEST_SECRET = SECRET;
  brainsLiveMock.mockReturnValue(true);
  getUserMock.mockResolvedValue({ data: { user: null } });
  membersMock.mockReturnValue({ data: [], error: null });
});

describe("POST /api/avatars/introspect", () => {
  it("returns 200 { say } enriched by the Brain on success", async () => {
    completeMock.mockResolvedValue("Sizing the anchor commitment before the IC call.");
    const res = await POST(req(validBody, authed));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: "Sizing the anchor commitment before the IC call." });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("clamps the model output to one sentence of at most 16 words", async () => {
    completeMock.mockResolvedValue(
      "I am carefully reviewing the fully executed subscription documents and reconciling every single wire before we close out the round today. Second sentence.",
    );
    const res = await POST(req(validBody, authed));
    expect(res.status).toBe(200);
    const { say } = (await res.json()) as { say: string };
    expect(say.split(/\s+/).length).toBeLessThanOrEqual(16);
    expect(say.endsWith(".")).toBe(true);
    expect(say).not.toContain("Second sentence");
  });

  it("returns 200 { say: null } when no API key/model is configured", async () => {
    brainsLiveMock.mockReturnValue(false);
    const res = await POST(req(validBody, authed));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: null });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("returns 200 { say: null } when the model yields nothing (error/empty)", async () => {
    completeMock.mockResolvedValue(null);
    const res = await POST(req(validBody, authed));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: null });
  });

  it("returns 200 { say: null } for an unknown avatar / no dedicated Brain", async () => {
    // "om" (Office Manager) is a real roster id with brainKey null.
    const res = await POST(req({ avatar: "om", behavior: "idle" }, authed));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: null });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("returns 200 { say: null } for an invalid body", async () => {
    const res = await POST(req({ behavior: "work_at_desk" }, authed)); // missing avatar
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: null });

    const malformed = await POST(req("not json{", authed));
    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toEqual({ say: null });
  });

  it("returns 401 when unauthenticated (no secret, no session)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(req(validBody)); // no Authorization header
    expect(res.status).toBe(401);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("authorizes an org member session without the Bearer secret", async () => {
    delete process.env.BRAIN_INGEST_SECRET;
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    membersMock.mockReturnValue({ data: [{ organization_id: "org1" }], error: null });
    completeMock.mockResolvedValue("Reviewing the pipeline.");
    const res = await POST(req(validBody)); // no Bearer, relies on session
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: "Reviewing the pipeline." });
  });
});
