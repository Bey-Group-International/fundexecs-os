/**
 * The in-call document route.
 *
 * The properties that matter here are permission properties, and they are the
 * opposite of the chat route's. The chat exists so a GUEST can take part; this
 * exists so a guest cannot — it reaches into the firm's data room, and the only
 * accepted caller is a signed-in member of the meeting's organization. The rest
 * is about not misrepresenting what happened: each failure gets its own status
 * and its own sentence, because "mint failed" and "that document is a draft"
 * need opposite things from the host.
 */
const authorizeMeetingMember = jest.fn();
const shareDocumentInMeeting = jest.fn();
const loadMeetingDocs = jest.fn();
const loadSharedInMeeting = jest.fn();
const checkRateLimit = jest.fn();
const from = jest.fn();

jest.mock("@/lib/meetings/meeting-access.server", () => ({
  authorizeMeetingMember: (...a: unknown[]) => authorizeMeetingMember(...a),
}));
jest.mock("@/lib/meetings/doc-share.server", () => ({
  loadMeetingDocs: (...a: unknown[]) => loadMeetingDocs(...a),
  loadSharedInMeeting: (...a: unknown[]) => loadSharedInMeeting(...a),
  shareDocumentInMeeting: (...a: unknown[]) => shareDocumentInMeeting(...a),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
  createServiceClient: () => ({ from: (t: string) => from(t) }),
  hasSupabaseServiceEnv: () => true,
}));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  clientIp: () => "1.2.3.4",
  rateLimitHeaders: () => ({}),
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };

const post = (body: unknown) =>
  new Request("http://localhost/api/meetings/m1/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

const get = () => new Request("http://localhost/api/meetings/m1/documents") as never;

function wireMeeting(title: string | null) {
  from.mockImplementation(() => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: { title } }),
    };
    return b;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockReturnValue({ ok: true, remaining: 10, resetAt: 0, retryAfter: 0 });
  authorizeMeetingMember.mockResolvedValue({ ok: true, userId: "user-1", orgId: "org-1", isHost: true });
  loadMeetingDocs.mockResolvedValue({ docs: [], truncated: false });
  loadSharedInMeeting.mockResolvedValue([]);
  shareDocumentInMeeting.mockResolvedValue({
    ok: true,
    url: "https://x.test/dataroom/tok",
    documentName: "Investor Deck",
    alreadyShared: false,
  });
  wireMeeting("Fund IV sync");
});

describe("permission", () => {
  it("refuses a guest, who is the person being shared WITH", async () => {
    authorizeMeetingMember.mockResolvedValue({ ok: false, userId: null, orgId: null, isHost: false });
    expect((await GET(get(), params)).status).toBe(401);
    expect((await POST(post({ documentId: "d1" }), params)).status).toBe(401);
    expect(shareDocumentInMeeting).not.toHaveBeenCalled();
  });

  it("refuses an authorized caller with no organization resolved", async () => {
    // Belt and braces: `ok` without an org is a contradiction, and the route
    // must not fall through to reading some other org's materials.
    authorizeMeetingMember.mockResolvedValue({ ok: true, userId: "user-1", orgId: null, isHost: false });
    expect((await GET(get(), params)).status).toBe(401);
  });

  it("scopes the listing to the organization the authorizer resolved", async () => {
    await GET(get(), params);
    expect(loadMeetingDocs).toHaveBeenCalledWith("org-1");
  });
});

describe("GET", () => {
  it("hands back the documents, the bound, and what is already shared", async () => {
    loadMeetingDocs.mockResolvedValue({ docs: [{ id: "d1" }], truncated: true });
    loadSharedInMeeting.mockResolvedValue([{ documentId: "d1", url: "u", sharedAt: "t" }]);

    const body = await (await GET(get(), params)).json();
    expect(body).toEqual({
      docs: [{ id: "d1" }],
      truncated: true,
      shared: [{ documentId: "d1", url: "u", sharedAt: "t" }],
    });
  });
});

describe("POST", () => {
  it("shares the document and returns the link", async () => {
    const body = await (await POST(post({ documentId: "d1" }), params)).json();
    expect(body).toEqual({
      url: "https://x.test/dataroom/tok",
      documentName: "Investor Deck",
      alreadyShared: false,
    });
  });

  it("takes the meeting's title from the meeting, never from the body", async () => {
    // The title becomes the share's label, which reaches the Shares list and
    // the audit export. A client that could set it could label the firm's own
    // link anything it liked.
    await POST(post({ documentId: "d1", meetingTitle: "Totally Routine" }), params);
    expect(shareDocumentInMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ meetingTitle: "Fund IV sync", orgId: "org-1", userId: "user-1" }),
    );
  });

  it("survives a meeting with no title", async () => {
    wireMeeting(null);
    await POST(post({ documentId: "d1" }), params);
    expect(shareDocumentInMeeting).toHaveBeenCalledWith(expect.objectContaining({ meetingTitle: null }));
  });

  it("asks which document when none is named", async () => {
    expect((await POST(post({}), params)).status).toBe(422);
    expect((await POST(post({ documentId: "   " }), params)).status).toBe(422);
    expect((await POST(post({ documentId: 7 }), params)).status).toBe(422);
    expect(shareDocumentInMeeting).not.toHaveBeenCalled();
  });

  it("survives a body that is not JSON at all", async () => {
    const bad = new Request("http://localhost/api/meetings/m1/documents", {
      method: "POST",
      body: "not json",
    }) as never;
    expect((await POST(bad, params)).status).toBe(422);
  });

  it("says 409 and why for a document that is not publishable", async () => {
    shareDocumentInMeeting.mockResolvedValue({ ok: false, reason: "not-shareable" });
    const res = await POST(post({ documentId: "d1" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not published|draft/i);
  });

  it("says 403 when the member may not mint a link", async () => {
    shareDocumentInMeeting.mockResolvedValue({ ok: false, reason: "mint-failed" });
    const res = await POST(post({ documentId: "d1" }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/permission/i);
  });

  it("says nothing was shared when the link could not be recorded", async () => {
    // The honest reading: a link exists but the firm has no record of issuing
    // it, so the host is told to try again rather than to announce it.
    shareDocumentInMeeting.mockResolvedValue({ ok: false, reason: "record-failed" });
    const res = await POST(post({ documentId: "d1" }), params);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/nothing was shared/i);
  });

  it("says 503 when the deployment cannot record a share at all", async () => {
    // An operator problem, not the host's: dressing it up as a permission
    // failure would send them looking for a role change that cannot help.
    shareDocumentInMeeting.mockResolvedValue({ ok: false, reason: "not-configured" });
    const res = await POST(post({ documentId: "d1" }), params);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });

  it("is rate limited, because each call is a write against the firm's materials", async () => {
    checkRateLimit.mockReturnValue({ ok: false, remaining: 0, resetAt: 0, retryAfter: 30 });
    expect((await POST(post({ documentId: "d1" }), params)).status).toBe(429);
    expect(shareDocumentInMeeting).not.toHaveBeenCalled();
  });

  it("does not rate limit the listing, which writes nothing", async () => {
    checkRateLimit.mockReturnValue({ ok: false, remaining: 0, resetAt: 0, retryAfter: 30 });
    expect((await GET(get(), params)).status).toBe(200);
  });
});
