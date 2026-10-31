// The native issuance provider reaches the envelope routes over HTTP, as the
// signed-in caller. These pin the parts that used to fail silently: no session
// cookie (every call a 401), an apex-domain deploy resolved to localhost, and a
// status response read at the wrong depth (always "draft").

let cookieHeader: string | null = "sb-access=abc; sb-refresh=def";
let outsideRequest = false;

jest.mock("next/headers", () => ({
  headers: async () => {
    if (outsideRequest) throw new Error("headers() was called outside a request scope");
    return { get: (name: string) => (name.toLowerCase() === "cookie" ? cookieHeader : null) };
  },
}));

const fetchMock = jest.fn();

function reply(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

import { nativeSigningProvider } from "./native-signing";

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  cookieHeader = "sb-access=abc; sb-refresh=def";
  outsideRequest = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_APP_URL = "https://fundexecs.com";
});

const draftParams = {
  orgId: "org-a",
  dealId: "deal-1",
  securityName: "Series A Units",
  offeringAmountUsd: 1000,
  investorIds: ["inv-1"],
  requestedBy: "user-1",
};

describe("reaching the envelope routes", () => {
  it("calls the app's own origin, including an apex-domain deploy, with the caller's session", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, envelopeId: "env-1" }));
    const res = await nativeSigningProvider.draftSecurity(draftParams);

    expect(res.ok).toBe(true);
    expect(res.data?.securityId).toBe("env-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fundexecs.com/api/envelopes/create");
    expect(init.headers.Cookie).toBe("sb-access=abc; sb-refresh=def");
  });

  it("sends no cookie when there is no request to take one from", async () => {
    outsideRequest = true;
    fetchMock.mockResolvedValue(reply({ ok: true, envelopeId: "env-1" }));
    await nativeSigningProvider.draftSecurity(draftParams);
    expect(fetchMock.mock.calls[0][1].headers.Cookie).toBeUndefined();
  });

  it("never forwards the session to a host outside the app", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://evil.example.com";
    delete process.env.NEXTAUTH_URL;
    fetchMock.mockResolvedValue(reply({ ok: true, envelopeId: "env-1" }));
    await nativeSigningProvider.draftSecurity(draftParams);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("evil.example.com");
  });

  it("stays offline in mock mode", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await nativeSigningProvider.draftSecurity(draftParams);
    expect(res.live).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a refused create instead of claiming a draft", async () => {
    fetchMock.mockResolvedValue(reply({ ok: false, error: "Unauthorized" }, false, 401));
    const res = await nativeSigningProvider.draftSecurity(draftParams);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Unauthorized");
  });
});

describe("getStatus", () => {
  const status = (s: string, completed_at: string | null = null) =>
    reply({ envelope: { id: "env-1", status: s, completed_at }, recipients: [], summary: {} });

  it.each([
    ["draft", "draft"],
    ["sent", "draft"],
    ["partially_signed", "draft"],
    ["completed", "issued"],
    ["voided", "cancelled"],
  ] as const)("reads the envelope's %s as %s", async (raw, expected) => {
    fetchMock.mockResolvedValue(status(raw, raw === "completed" ? "2026-10-31T00:00:00Z" : null));
    const res = await nativeSigningProvider.getStatus("env-1", "org-a");
    expect(res.ok).toBe(true);
    expect(res.data?.status).toBe(expected);
  });

  it("carries the completion time once issued", async () => {
    fetchMock.mockResolvedValue(status("completed", "2026-10-31T00:00:00Z"));
    const res = await nativeSigningProvider.getStatus("env-1", "org-a");
    expect(res.data?.issuedAt).toBe("2026-10-31T00:00:00Z");
  });

  it("surfaces a failed lookup", async () => {
    fetchMock.mockResolvedValue(reply({ error: "Envelope not found" }, false, 404));
    const res = await nativeSigningProvider.getStatus("env-1", "org-a");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Envelope not found");
  });
});

describe("issueSecurity", () => {
  it("sends the envelope and says it is awaiting signers, not issued", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, signingUrls: [] }));
    const res = await nativeSigningProvider.issueSecurity("env-1", "user-1", "org-a");

    expect(fetchMock.mock.calls[0][0]).toBe("https://fundexecs.com/api/envelopes/env-1/send");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(res.ok).toBe(true);
    expect(res.data?.status).toBe("draft");
    expect(res.detail).toContain("awaiting signers");
  });

  it("reports a refused send", async () => {
    fetchMock.mockResolvedValue(reply({ error: "Envelope not found" }, false, 404));
    const res = await nativeSigningProvider.issueSecurity("env-1", "user-1", "org-a");
    expect(res.ok).toBe(false);
  });
});
