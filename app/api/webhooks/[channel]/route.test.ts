// Coverage for the generic inbound webhook route (audit P1 #15). The security
// contract is what matters here: unknown channels 404, unparseable orgs 400,
// and — critically — no secret means 401 and a bad signature means 401, so an
// unsigned or forged payload can never reach the inbox. Signature verification
// runs the REAL Calendly HMAC path; only credential resolution and persistence
// are mocked.

const getOrgSecret = jest.fn();
jest.mock("@/lib/org-secrets", () => ({
  getOrgSecret: (...a: unknown[]) => getOrgSecret(...a),
}));

const ingestInboundEvent = jest.fn();
jest.mock("@/lib/integrations/inbound/ingest", () => ({
  ingestInboundEvent: (...a: unknown[]) => ingestInboundEvent(...a),
}));

const orgLookup = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => orgLookup() }) }),
    }),
  }),
}));

import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { POST } from "./route";

const ORG = "123e4567-e89b-12d3-a456-426614174000";
const SECRET = "cal-signing-key";

const PAYLOAD = JSON.stringify({
  event: "invitee.created",
  payload: {
    uri: "https://api.calendly.com/scheduled_events/ev-1/invitees/inv-1",
    name: "Dana LP",
    email: "dana@lp.test",
    scheduled_event: {
      uri: "https://api.calendly.com/scheduled_events/ev-1",
      name: "Intro call",
      start_time: "2026-07-10T15:00:00Z",
    },
  },
});

function signedHeaders(body: string, secret: string = SECRET): Record<string, string> {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { "calendly-webhook-signature": `t=${t},v1=${v1}` };
}

function request(
  channel: string,
  { org = ORG, body = PAYLOAD, headers = signedHeaders(PAYLOAD) } = {},
): [NextRequest, { params: Promise<{ channel: string }> }] {
  const url = `http://localhost/api/webhooks/${channel}${org ? `?org=${org}` : ""}`;
  return [
    new NextRequest(url, { method: "POST", body, headers }),
    { params: Promise.resolve({ channel }) },
  ];
}

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  delete process.env.CALENDLY_WEBHOOK_SECRET;
  getOrgSecret.mockResolvedValue(SECRET);
  orgLookup.mockResolvedValue({ data: { id: ORG }, error: null });
  ingestInboundEvent.mockResolvedValue({
    ok: true,
    duplicate: false,
    threadId: "thr-1",
    created: true,
  });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("POST /api/webhooks/[channel]", () => {
  it("404s an unknown channel", async () => {
    const res = await POST(...request("hubspot"));
    expect(res.status).toBe(404);
  });

  it("400s a missing or malformed org parameter", async () => {
    expect((await POST(...request("calendly", { org: "" }))).status).toBe(400);
    expect((await POST(...request("calendly", { org: "not-a-uuid" }))).status).toBe(400);
  });

  it("fails closed with 401 when no signing secret is configured anywhere", async () => {
    getOrgSecret.mockResolvedValue(null);
    const res = await POST(...request("calendly"));
    expect(res.status).toBe(401);
    expect(ingestInboundEvent).not.toHaveBeenCalled();
  });

  it("401s a forged signature and never ingests", async () => {
    const res = await POST(
      ...request("calendly", { headers: signedHeaders(PAYLOAD, "wrong-key") }),
    );
    expect(res.status).toBe(401);
    expect(ingestInboundEvent).not.toHaveBeenCalled();
  });

  it("verifies against the org's vault secret before the env fallback", async () => {
    // Org secret differs from env; the request is signed with the org's.
    getOrgSecret.mockResolvedValue("org-specific-key");
    process.env.CALENDLY_WEBHOOK_SECRET = "deploy-wide-key";
    const res = await POST(
      ...request("calendly", { headers: signedHeaders(PAYLOAD, "org-specific-key") }),
    );
    expect(res.status).toBe(200);
    expect(getOrgSecret).toHaveBeenCalledWith(ORG, "CALENDLY_WEBHOOK_SECRET");
  });

  it("falls back to the deploy env secret when the org has none stored", async () => {
    getOrgSecret.mockResolvedValue(null);
    process.env.CALENDLY_WEBHOOK_SECRET = SECRET;
    const res = await POST(...request("calendly"));
    expect(res.status).toBe(200);
  });

  it("acknowledges but does not ingest a deliberately-ignored event type", async () => {
    const body = JSON.stringify({ event: "routing_form_submission.created" });
    const res = await POST(...request("calendly", { body, headers: signedHeaders(body) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(ingestInboundEvent).not.toHaveBeenCalled();
  });

  it("404s a signed request against an unknown organization", async () => {
    orgLookup.mockResolvedValue({ data: null, error: null });
    const res = await POST(...request("calendly"));
    expect(res.status).toBe(404);
    expect(ingestInboundEvent).not.toHaveBeenCalled();
  });

  it("ingests a verified event and reports where it landed", async () => {
    const res = await POST(...request("calendly"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, threadId: "thr-1", created: true });
    const [, orgId, channel, event] = ingestInboundEvent.mock.calls[0];
    expect(orgId).toBe(ORG);
    expect(channel).toBe("calendly");
    expect((event as { eventType: string }).eventType).toBe("invitee.created");
  });

  it("acknowledges provider retries flagged as duplicates", async () => {
    ingestInboundEvent.mockResolvedValue({ ok: true, duplicate: true });
    const res = await POST(...request("calendly"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
  });

  it("500s on an ingest failure so the provider retries", async () => {
    ingestInboundEvent.mockResolvedValue({ ok: false, error: "db down" });
    const res = await POST(...request("calendly"));
    expect(res.status).toBe(500);
  });
});
