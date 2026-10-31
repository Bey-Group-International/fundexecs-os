export {};
const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body) });

const params = {
  orgId: "org-a",
  subjectId: "sess-1",
  subjectType: "individual" as const,
  subjectName: "Jo Park",
  subjectEmail: "jo@example.com",
  level: "kyc" as const,
  requestedBy: "lp-wizard",
};

describe("stripe identity initiate", () => {
  it("sends the return URL and tags the session with its organization", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "vs_1", status: "requires_input", url: "https://verify.stripe.com/start/x", created: 1 }));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const res = await stripeIdentityProvider.initiate({ ...params, returnUrl: "https://app.example.com/lp/tok" });
    expect(res).toMatchObject({ ok: true, reference: "https://verify.stripe.com/start/x", data: { verificationId: "vs_1", status: "pending", providerStatus: "requires_input" } });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("return_url")).toBe("https://app.example.com/lp/tok");
    expect(body.get("metadata[org_id]")).toBe("org-a");
    expect(body.get("metadata[subject_id]")).toBe("sess-1");
    expect(body.get("options[document][require_matching_selfie]")).toBe("true");
  });

  it("sends no return URL when none is given", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "vs_1", status: "requires_input", url: "https://verify.stripe.com/start/x", created: 1 }));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    await stripeIdentityProvider.initiate(params);
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body as string).has("return_url")).toBe(false);
  });

  it("fails without leaking Stripe's error", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(json({ error: "secret detail" }, false));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const res = await stripeIdentityProvider.initiate(params);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("secret detail");
  });
});

describe("stripe identity getStatus", () => {
  const session = (over: Record<string, unknown> = {}) => ({ id: "vs_1", status: "requires_input", created: 1, url: "https://verify.stripe.com/start/x", metadata: { org_id: "org-a" }, ...over });

  it("hands back the hosted link and Stripe's own status while the LP can still finish", async () => {
    fetchMock.mockResolvedValueOnce(json(session()));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const res = await stripeIdentityProvider.getStatus("vs_1", "org-a");
    expect(res).toMatchObject({ ok: true, reference: "https://verify.stripe.com/start/x", data: { status: "pending", providerStatus: "requires_input" } });
  });

  it("maps verified to approved and a failed attempt to a note", async () => {
    fetchMock.mockResolvedValueOnce(json(session({ status: "verified", url: null })));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const done = await stripeIdentityProvider.getStatus("vs_1", "org-a");
    expect(done.data).toMatchObject({ status: "approved", providerStatus: "verified" });
    expect(done.reference).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json(session({ last_error: { reason: "Document expired" } })));
    const failed = await stripeIdentityProvider.getStatus("vs_1", "org-a");
    expect(failed.data).toMatchObject({ status: "pending", notes: "Document expired" });
  });

  it("will not return another organization's session or its link", async () => {
    fetchMock.mockResolvedValueOnce(json(session()));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const res = await stripeIdentityProvider.getStatus("vs_1", "org-b");
    expect(res.ok).toBe(false);
    expect(res.reference).toBeUndefined();
  });
});
