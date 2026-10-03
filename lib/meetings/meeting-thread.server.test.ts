import { ensureMeetingThread } from "./meeting-thread.server";

const recordThreadOnTimeline = jest.fn();
jest.mock("@/lib/inbox/crm-activity.server", () => ({
  recordThreadOnTimeline: (...a: unknown[]) => recordThreadOnTimeline(...a),
}));

/** A fake client answering the three lookups in order: own thread, keyed thread. */
function client(opts: { own?: unknown; keyed?: unknown }) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const lookups: string[] = [];
  const from = () => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        filters[c] = v;
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const which = "meeting_id" in filters ? "own" : "keyed";
        lookups.push(which);
        return { data: which === "own" ? (opts.own ?? null) : (opts.keyed ?? null), error: null };
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "thr-new" }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    });
    return chain;
  };
  return { c: { from } as never, inserts, updates, lookups };
}

const INPUT = {
  orgId: "org-1",
  actorId: "u1",
  meetingId: "m1",
  recipient: { name: "Ana Lopez", email: "Ana@Acme.com" },
  subject: "Next steps",
  preview: "Hi Ana",
};

beforeEach(() => recordThreadOnTimeline.mockReset());

it("continues this meeting's thread with them first, whatever its subject", async () => {
  const db = client({ own: { id: "thr-own", subject: "Follow-up: Series B sync" } });
  expect(await ensureMeetingThread(db.c, INPUT)).toEqual({
    ok: true,
    threadId: "thr-own",
    subject: "Follow-up: Series B sync",
    continued: true,
  });
  expect(db.lookups).toEqual(["own"]);
  expect(db.inserts).toEqual([]);
});

it("links and reuses the thread the reply key resolves to", async () => {
  const db = client({ keyed: { id: "thr-keyed", subject: "Next steps" } });
  expect(await ensureMeetingThread(db.c, INPUT)).toMatchObject({ threadId: "thr-keyed", continued: true });
  expect(db.updates).toEqual([{ meeting_id: "m1" }]);
});

it("creates a linked thread on the reply key and puts it on the timeline", async () => {
  const db = client({});
  expect(await ensureMeetingThread(db.c, INPUT)).toEqual({ ok: true, threadId: "thr-new", subject: "Next steps", continued: false });
  expect(db.inserts[0]).toMatchObject({
    counterparty_email: "ana@acme.com",
    external_id: "email:ana@acme.com:next steps",
    meeting_id: "m1",
    channel: "gmail",
  });
  expect(recordThreadOnTimeline).toHaveBeenCalledTimes(1);
});

it("refuses an unusable address", async () => {
  const db = client({});
  expect(await ensureMeetingThread(db.c, { ...INPUT, recipient: { name: "X", email: "nope" } })).toMatchObject({ ok: false });
});
