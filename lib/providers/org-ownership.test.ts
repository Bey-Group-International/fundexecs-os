// A provider reference (transfer, verification session, envelope) is only
// readable or actionable by the organization that created it. Anyone else gets
// what a missing object gets.

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function json(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("stripe capital rail getStatus", () => {
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
  });

  const transfer = { id: "obt_1", status: "posted", amount: 100, created: 1_700_000_000, metadata: { org_id: "org-a" } };

  it("returns the transfer to the organization that made it", async () => {
    fetchMock.mockResolvedValueOnce(json(transfer));
    const { stripeCapitalRailProvider } = await import("./stripe-rail");
    const res = await stripeCapitalRailProvider.getStatus("obt_1", "org-a");
    expect(res.ok).toBe(true);
    expect(res.data?.status).toBe("settled");
  });

  it("treats another organization's transfer as not found on every path", async () => {
    fetchMock.mockResolvedValue(json(transfer));
    const { stripeCapitalRailProvider } = await import("./stripe-rail");
    const res = await stripeCapitalRailProvider.getStatus("obt_1", "org-b");
    expect(res.ok).toBe(false);
    expect(res.detail).toBe("Could not fetch status for transfer obt_1.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refuses a transfer with no organization recorded, and a caller with none", async () => {
    fetchMock.mockResolvedValue(json({ ...transfer, metadata: {} }));
    const { stripeCapitalRailProvider } = await import("./stripe-rail");
    expect((await stripeCapitalRailProvider.getStatus("obt_1", "org-a")).ok).toBe(false);
    fetchMock.mockResolvedValue(json({ ...transfer, metadata: { org_id: "" } }));
    expect((await stripeCapitalRailProvider.getStatus("obt_1", "")).ok).toBe(false);
  });
});

describe("stripe identity getStatus", () => {
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
  });

  const session = { id: "vs_1", status: "verified", created: 1_700_000_000, metadata: { org_id: "org-a" } };

  it("returns the session to the organization that requested it", async () => {
    fetchMock.mockResolvedValueOnce(json(session));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const res = await stripeIdentityProvider.getStatus("vs_1", "org-a");
    expect(res.ok).toBe(true);
    expect(res.data?.status).toBe("approved");
  });

  it("treats another organization's session as not found", async () => {
    fetchMock.mockResolvedValueOnce(json(session));
    const { stripeIdentityProvider } = await import("./stripe-identity");
    const res = await stripeIdentityProvider.getStatus("vs_1", "org-b");
    expect(res.ok).toBe(false);
    expect(res.data?.status).toBe("pending");
  });
});

describe("docusign issuance", () => {
  beforeAll(() => {
    process.env.DOCUSIGN_ACCESS_TOKEN = "tok";
    process.env.DOCUSIGN_ACCOUNT_ID = "acct";
  });

  const id = "11111111-2222-3333-4444-555555555555";
  const envelope = (org?: string) => ({
    status: "created",
    customFields: { textCustomFields: org ? [{ name: "fundexecs_org_id", value: org }] : [] },
  });

  it("reads an envelope for the organization it was created for", async () => {
    fetchMock.mockResolvedValueOnce(json(envelope("org-a")));
    const { docusignIssuanceProvider } = await import("./docusign-issuance");
    const res = await docusignIssuanceProvider.getStatus(id, "org-a");
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("include=custom_fields");
  });

  it("never builds a request from an id that isn't a UUID", async () => {
    const { docusignIssuanceProvider } = await import("./docusign-issuance");
    const bad = "../../accounts/other/envelopes/x";
    expect((await docusignIssuanceProvider.getStatus(bad, "org-a")).ok).toBe(false);
    expect((await docusignIssuanceProvider.issueSecurity(bad, "user-1", "org-a")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses another organization's envelope, and one with no owner", async () => {
    const { docusignIssuanceProvider } = await import("./docusign-issuance");
    fetchMock.mockResolvedValueOnce(json(envelope("org-a")));
    expect((await docusignIssuanceProvider.getStatus(id, "org-b")).ok).toBe(false);
    fetchMock.mockResolvedValueOnce(json(envelope()));
    expect((await docusignIssuanceProvider.getStatus(id, "org-a")).ok).toBe(false);
  });

  it("won't send another organization's envelope", async () => {
    fetchMock.mockResolvedValueOnce(json(envelope("org-a")));
    const { docusignIssuanceProvider } = await import("./docusign-issuance");
    const res = await docusignIssuanceProvider.issueSecurity(id, "user-1", "org-b");
    expect(res.ok).toBe(false);
    // Only the ownership read happened; the PUT that sends it never did.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });

  it("sends its own envelope after the ownership read", async () => {
    fetchMock.mockResolvedValueOnce(json(envelope("org-a"))).mockResolvedValueOnce(json({}));
    const { docusignIssuanceProvider } = await import("./docusign-issuance");
    const res = await docusignIssuanceProvider.issueSecurity(id, "user-1", "org-a");
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
  });

  it("records the organization on the envelope it creates", async () => {
    fetchMock.mockResolvedValueOnce(json({ envelopeId: id }));
    const { docusignIssuanceProvider } = await import("./docusign-issuance");
    await docusignIssuanceProvider.draftSecurity({
      orgId: "org-a",
      dealId: "d1",
      securityName: "Units",
      offeringAmountUsd: 1000,
      investorIds: [],
      requestedBy: "user-1",
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.customFields.textCustomFields).toEqual([{ name: "fundexecs_org_id", value: "org-a", show: "false" }]);
  });
});
