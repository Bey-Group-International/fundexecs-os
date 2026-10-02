jest.mock("server-only", () => ({}), { virtual: true });
const create = jest.fn();
jest.mock("@/lib/anthropic-client", () => ({
  anthropicClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  LONG_RUN_TIMEOUT_MS: 1,
}));

import { crmMatches, DATA_ROOM_CONFLICT_TARGET, draftFollowUp, syncRoomTimeline } from "./data-room-crm.server";
import { buildEngagement, type EngagementView } from "./data-room-engagement";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const calls: { table: string; or?: string; upsert?: Row[]; onConflict?: string }[] = [];
  const client = {
    from: (table: string) => {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      const rows = tables[table] ?? [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        or: (f: string) => ((call.or = f), q),
        upsert: (r: Row[], o: { onConflict: string }) => {
          call.upsert = r;
          call.onConflict = o.onConflict;
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(resolve),
      };
      return q;
    },
  };
  return { client: client as never, calls };
}

describe("crmMatches", () => {
  it("links only exact addresses, whatever case the CRM stored them in", async () => {
    const db = fakeDb({
      network_contacts: [
        { id: "c1", email: "Jane.Doe@Fund.com", full_name: "Jane Doe" },
        // What a LIKE prefilter can let through; must not link.
        { id: "c2", email: "janexdoe@fund.com", full_name: "Wrong" },
      ],
      investors: [{ id: "i1", contact_email: "jane.doe@fund.com", name: "Doe Family Office" }],
    });
    const m = await crmMatches(db.client, "org-1", ["jane.doe@fund.com", "nobody@x.com"]);
    expect([...m.entries()]).toEqual([
      ["jane.doe@fund.com", { contactId: "c1", contactName: "Jane Doe", investorId: "i1", investorName: "Doe Family Office" }],
    ]);
    expect(db.calls[0].or).toBe("email.ilike.jane.doe@fund.com,email.ilike.nobody@x.com");
  });

  it("escapes wildcards and keeps crafted addresses out of the filter", async () => {
    const db = fakeDb({});
    await crmMatches(db.client, "org-1", ["a_b@x.com", "x@y.com,id.neq.0", "z@q.com)"]);
    expect(db.calls[0].or).toBe("email.ilike.a\\_b@x.com");
  });

  it("asks nothing when there is nobody to match", async () => {
    const db = fakeDb({});
    expect((await crmMatches(db.client, "org-1", [])).size).toBe(0);
    expect(db.calls).toEqual([]);
  });
});

describe("syncRoomTimeline", () => {
  const now = new Date("2026-10-02T13:00:00Z");
  const v = (o: Partial<EngagementView>): EngagementView => ({
    share_id: "l1",
    document_id: "ppm",
    kind: "document",
    action: "read",
    viewer_email: "jane.doe@fund.com",
    session_id: "b1",
    duration_seconds: 600,
    created_at: "2026-10-02T09:00:00Z",
    ...o,
  });

  it("upserts one entry per matched contact per day, keyed so re-runs update it", async () => {
    const investors = buildEngagement(
      [v({}), v({ viewer_email: "stranger@x.com", session_id: "b2" }), v({ viewer_email: null, session_id: "b3" })],
      new Map([["ppm", "PPM v3"]]),
      new Map(),
      now.getTime(),
    ).investors;
    const db = fakeDb({ network_contacts: [{ id: "c1", email: "jane.doe@fund.com", full_name: "Jane Doe" }], investors: [] });
    expect(await syncRoomTimeline(db.client, "org-1", { id: "room-1", name: "Fund II" }, investors, now)).toEqual({ written: 1 });
    const up = db.calls.find((c) => c.upsert)!;
    expect(up.table).toBe("network_activities");
    expect(up.onConflict).toBe(DATA_ROOM_CONFLICT_TARGET);
    expect(up.upsert).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        contact_id: "c1",
        investor_id: null,
        activity_type: "document",
        direction: "inbound",
        subject: "Read the Fund II data room (10 min)",
        is_system: true,
        metadata: expect.objectContaining({ data_room_key: "room-1:2026-10-02", room_id: "room-1" }),
      }),
    ]);
  });

  it("names plain columns as its conflict target", () => {
    expect(DATA_ROOM_CONFLICT_TARGET).toBe("organization_id,contact_id,data_room_key");
  });
});

describe("draftFollowUp", () => {
  const reader = buildEngagement(
    [
      {
        share_id: "l1",
        document_id: "ppm",
        kind: "document",
        action: "read",
        viewer_email: "jane@x.com",
        session_id: "b1",
        duration_seconds: 900,
        created_at: "2026-10-02T09:00:00Z",
      },
    ],
    new Map([["ppm", "PPM v3"]]),
  ).investors[0];
  const ctx = { roomName: "Fund II", recipientName: "Jane", senderName: "Sam", nextStep: "Offer a terms call.", summary: "Deep in the PPM." };

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    create.mockReset();
  });

  it("uses the template without a model", async () => {
    expect((await draftFollowUp(reader, ctx)).source).toBe("template");
  });

  it("takes Earn's draft, grounded in what the reader did", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ subject: "Fund II terms", body: "Hi Jane, ..." }) }] });
    expect(await draftFollowUp(reader, ctx)).toEqual({ subject: "Fund II terms", body: "Hi Jane, ...", source: "earn" });
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("PPM v3: read 15 min");
    expect(prompt).toContain("Suggested next step: Offer a terms call.");
  });

  it("falls back when the model fails or returns nothing usable", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    create.mockRejectedValueOnce(new Error("overloaded"));
    expect((await draftFollowUp(reader, ctx)).source).toBe("template");
    create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ subject: "", body: "" }) }] });
    expect((await draftFollowUp(reader, ctx)).source).toBe("template");
  });
});
