// Outbound webhook coverage (audit P2 — v1 event subscriptions). What matters:
// subscription validation (https-only, catalog-checked events), a signature an
// integrator can actually verify, and the sweep's cursor discipline — advance
// on success (and past filtered-out events), hold on failure so the window
// retries, and auto-disable after a failure streak.
import { createHmac } from "crypto";

const decryptSecret = jest.fn();
jest.mock("@/lib/vault", () => ({
  decryptSecret: (...a: unknown[]) => decryptSecret(...a),
}));

import {
  DISABLE_AFTER_FAILURES,
  generateWebhookSecret,
  parseWebhookSubscription,
  runWebhookDeliveries,
  signWebhookPayload,
} from "./webhooks-outbound";

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  jest.clearAllMocks();
  decryptSecret.mockReturnValue("whsec_test");
});

describe("parseWebhookSubscription", () => {
  it("accepts an https url with catalog events and dedupes them", () => {
    const parsed = parseWebhookSubscription({
      url: "https://example.com/hooks",
      events: ["task.completed", "task.completed", "dispatch.sent"],
      description: "CI notifier",
    });
    expect(parsed).toEqual({
      ok: true,
      url: "https://example.com/hooks",
      events: ["task.completed", "dispatch.sent"],
      description: "CI notifier",
    });
  });

  it("defaults omitted events to all (empty list)", () => {
    const parsed = parseWebhookSubscription({ url: "https://example.com/hooks" });
    expect(parsed).toEqual({ ok: true, url: "https://example.com/hooks", events: [], description: null });
  });

  it("rejects http, bad urls, unknown events, and unknown fields", () => {
    expect(parseWebhookSubscription({ url: "http://example.com" }).ok).toBe(false);
    expect(parseWebhookSubscription({ url: "not a url" }).ok).toBe(false);
    expect(parseWebhookSubscription({ url: "https://x.test", events: ["task.exploded"] }).ok).toBe(false);
    expect(parseWebhookSubscription({ url: "https://x.test", secret: "mine" }).ok).toBe(false);
    expect(parseWebhookSubscription("https://x.test").ok).toBe(false);
  });
});

describe("signing", () => {
  it("mints whsec_ secrets and signs so the documented recipe verifies", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);

    const body = '{"events":[]}';
    const signature = signWebhookPayload(secret, 1_760_000_000, body);
    const expected = `v1=${createHmac("sha256", secret).update(`1760000000.${body}`).digest("hex")}`;
    expect(signature).toBe(expected);
  });
});

// A recording mock around the three tables the sweep touches. Endpoint rows go
// in; task_events/dispatch_log rows come back from the org queries; updates are
// captured for assertions.
function makeSupabase(opts: {
  endpoints: Array<Record<string, unknown>>;
  taskEvents?: Array<Record<string, unknown>>;
  dispatches?: Array<Record<string, unknown>>;
}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; id: unknown }> = [];

  function builder(table: string) {
    let op = "select";
    let values: Record<string, unknown> = {};
    let idFilter: unknown;
    const b: Record<string, unknown> = {
      select: () => b,
      update: (v: Record<string, unknown>) => {
        op = "update";
        values = v;
        return b;
      },
      eq: (col: string, v: unknown) => {
        if (col === "id") idFilter = v;
        return b;
      },
      gt: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      then: (onFulfilled: (v: unknown) => unknown) => {
        if (op === "update") {
          updates.push({ table, values, id: idFilter });
          return Promise.resolve({ data: null, error: null }).then(onFulfilled);
        }
        const data =
          table === "webhook_endpoints"
            ? opts.endpoints
            : table === "task_events"
              ? (opts.taskEvents ?? [])
              : (opts.dispatches ?? []);
        return Promise.resolve({ data, error: null }).then(onFulfilled);
      },
    };
    return b;
  }

  return { client: { from: (t: string) => builder(t) } as never, updates };
}

const endpoint = (overrides: Record<string, unknown> = {}) => ({
  id: "ep-1",
  organization_id: "org-1",
  url: "https://example.com/hooks",
  events: [],
  ciphertext: "c",
  iv: "i",
  auth_tag: "t",
  cursor_at: "2026-07-04T00:00:00Z",
  consecutive_failures: 0,
  disabled_at: null,
  ...overrides,
});

const taskEvent = (id: string, createdAt: string, type = "task.completed") => ({
  id,
  event_type: type,
  task_id: "task-1",
  agent: "associate",
  hub: "source",
  payload: {},
  created_at: createdAt,
});

const NOW = new Date("2026-07-04T01:00:00Z");

describe("runWebhookDeliveries", () => {
  it("delivers a signed batch and advances the cursor on 2xx", async () => {
    const { client, updates } = makeSupabase({
      endpoints: [endpoint()],
      taskEvents: [taskEvent("ev-1", "2026-07-04T00:10:00Z"), taskEvent("ev-2", "2026-07-04T00:20:00Z")],
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const stats = await runWebhookDeliveries(client, NOW);

    expect(stats).toEqual({ endpoints: 1, delivered: 1, failed: 0, disabled: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hooks");
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    // The delivery verifies with the documented recipe against the decrypted secret.
    expect(headers["fx-webhook-signature"]).toBe(
      signWebhookPayload("whsec_test", Number(headers["fx-webhook-timestamp"]), body),
    );
    expect(JSON.parse(body).count).toBe(2);

    const update = updates.find((u) => u.table === "webhook_endpoints");
    expect(update?.values.cursor_at).toBe("2026-07-04T00:20:00Z");
    expect(update?.values.consecutive_failures).toBe(0);
  });

  it("holds the cursor and counts the failure when the endpoint errors", async () => {
    const { client, updates } = makeSupabase({
      endpoints: [endpoint({ consecutive_failures: 3 })],
      taskEvents: [taskEvent("ev-1", "2026-07-04T00:10:00Z")],
    });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const stats = await runWebhookDeliveries(client, NOW);

    expect(stats.failed).toBe(1);
    const update = updates.find((u) => u.table === "webhook_endpoints");
    expect(update?.values.cursor_at).toBeUndefined(); // window retries next sweep
    expect(update?.values.consecutive_failures).toBe(4);
    expect(update?.values.disabled_at).toBeUndefined();
  });

  it("auto-disables after the failure streak threshold", async () => {
    const { client, updates } = makeSupabase({
      endpoints: [endpoint({ consecutive_failures: DISABLE_AFTER_FAILURES - 1 })],
      taskEvents: [taskEvent("ev-1", "2026-07-04T00:10:00Z")],
    });
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const stats = await runWebhookDeliveries(client, NOW);

    expect(stats.disabled).toBe(1);
    const update = updates.find((u) => u.table === "webhook_endpoints");
    expect(update?.values.disabled_at).toBe(NOW.toISOString());
  });

  it("filters by subscribed events but still advances past unmatched ones", async () => {
    const { client, updates } = makeSupabase({
      endpoints: [endpoint({ events: ["dispatch.sent"] })],
      taskEvents: [taskEvent("ev-1", "2026-07-04T00:10:00Z", "task.progress")],
    });

    const stats = await runWebhookDeliveries(client, NOW);

    // Nothing to deliver — but the cursor moves so this event never wedges it.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.delivered).toBe(0);
    const update = updates.find((u) => u.table === "webhook_endpoints");
    expect(update?.values.cursor_at).toBe("2026-07-04T00:10:00Z");
  });

  it("merges dispatch_log rows as dispatch.sent events", async () => {
    const { client } = makeSupabase({
      endpoints: [endpoint()],
      dispatches: [
        {
          id: "d-1",
          action: "send_outreach",
          channel: "gmail",
          live: true,
          ok: true,
          detail: "Email sent",
          reference: null,
          task_id: null,
          created_at: "2026-07-04T00:30:00Z",
        },
      ],
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await runWebhookDeliveries(client, NOW);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.events[0].type).toBe("dispatch.sent");
    expect(body.events[0].data.channel).toBe("gmail");
  });

  it("skips delivery quietly when nothing is pending", async () => {
    const { client, updates } = makeSupabase({ endpoints: [endpoint()] });
    const stats = await runWebhookDeliveries(client, NOW);
    expect(stats).toEqual({ endpoints: 1, delivered: 0, failed: 0, disabled: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("skips (without a failure strike) when the secret cannot be decrypted", async () => {
    decryptSecret.mockImplementation(() => {
      throw new Error("FUNDEXECS_VAULT_KEY is not configured");
    });
    const { client, updates } = makeSupabase({
      endpoints: [endpoint()],
      taskEvents: [taskEvent("ev-1", "2026-07-04T00:10:00Z")],
    });

    const stats = await runWebhookDeliveries(client, NOW);

    expect(stats.failed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
