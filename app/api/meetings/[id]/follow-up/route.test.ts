/**
 * Sending a meeting's follow-up.
 *
 * This reaches everyone who was in the room, over the host's name, so the
 * cases that matter are who it goes to, who may press it, and what it says
 * when it cannot.
 */
const requireOrgContext = jest.fn();
const from = jest.fn();
const sendEmail = jest.fn();
const mailboxFor = jest.fn();
const recordFollowUpThreads = jest.fn();
let serviceEnv = false;
let gated = false;
const replyToThread = jest.fn();
const ensureMeetingThread = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
  createServiceClient: () => ({ service: true }),
  hasSupabaseServiceEnv: () => serviceEnv,
}));
jest.mock("@/lib/meetings/follow-up-threads.server", () => ({
  recordFollowUpThreads: (...a: unknown[]) => recordFollowUpThreads(...a),
}));
jest.mock("@/lib/mandates", () => ({ getActiveMandate: async () => undefined }));
jest.mock("@/lib/gates", () => ({ gateDecision: () => ({ requiresApproval: gated, tier: gated ? 2 : 1 }) }));
jest.mock("@/app/(app)/inbox/actions", () => ({ replyToThread: (fd: FormData) => replyToThread(fd) }));
jest.mock("@/lib/meetings/meeting-thread.server", () => ({
  ensureMeetingThread: (...a: unknown[]) => ensureMeetingThread(...a),
}));
jest.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));
jest.mock("@/lib/meetings/mailbox.server", () => ({ mailboxFor: (...a: unknown[]) => mailboxFor(...a) }));

import { POST } from "./route";

const HOST = { ok: true, ctx: { userId: "host-1", orgId: "org-1", email: "host@fund.test" } };

const MEETING = {
  id: "m1",
  title: "Series B sync",
  host_id: "host-1",
  organization_id: "org-1",
  attendees: [
    { name: "Sarah Chen", email: "sarah@fund.test" },
    { name: "Host", email: "host@fund.test" },
    { name: "Priya" },
  ],
};

const REPORT = { analysis: { follow_up_draft: "Hi all,\n\nGood meeting.\n\n— Host" } };

/** What the route wrote back to the meeting row. */
const updates: Record<string, unknown>[] = [];

function wire({ meeting = MEETING as unknown, report = REPORT as unknown, updateError = null as null | { message: string } } = {}) {
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => Object.assign(Promise.resolve({ error: updateError }), b),
      is: () => b,
      order: () => b,
      limit: () => b,
      update: (row: Record<string, unknown>) => {
        if (table === "live_meetings") updates.push(row);
        return b;
      },
      maybeSingle: async () => ({
        data: table === "live_meetings" ? meeting : report,
        error: null,
      }),
    };
    return b;
  });
}

const req = (body?: unknown) =>
  new Request("http://localhost/api/meetings/m1/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }) as never;

const params = Promise.resolve({ id: "m1" });

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;
  requireOrgContext.mockResolvedValue(HOST);
  mailboxFor.mockResolvedValue({ ok: true, token: "tok" });
  sendEmail.mockResolvedValue({ ok: true });
  serviceEnv = false;
  gated = false;
  recordFollowUpThreads.mockResolvedValue({ recorded: 0, tracked: 0 });
});

describe("permission", () => {
  it("refuses anyone who is not the host", async () => {
    wire({ meeting: { ...MEETING, host_id: "someone-else" } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("404s a meeting that is not there", async () => {
    wire({ meeting: null });
    expect((await POST(req(), { params })).status).toBe(404);
  });
});

describe("who it reaches", () => {
  it("sends to the attendees who have an address, and not to the sender", async () => {
    wire();
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, total: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: { name: "Sarah Chen", email: "sarah@fund.test" },
      subject: "Follow-up: Series B sync",
    });
  });

  it("says so rather than reporting a successful send to nobody", async () => {
    wire({ meeting: { ...MEETING, attendees: [{ name: "Priya" }] } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/email address/i);
  });
});

describe("what it sends", () => {
  it("sends the stored draft when the host has not edited it", async () => {
    wire();
    await POST(req(), { params });
    expect(String(sendEmail.mock.calls[0][0].htmlBody)).toContain("Good meeting.");
  });

  it("sends the host's edit in preference to the stored draft", async () => {
    // A draft nobody can change before it goes out under their name is not a
    // draft, and copying it out to fix one sentence is where this started.
    wire();
    await POST(req({ body: "Rewritten by hand." }), { params });
    const html = String(sendEmail.mock.calls[0][0].htmlBody);
    expect(html).toContain("Rewritten by hand.");
    expect(html).not.toContain("Good meeting.");
  });

  it("refuses when there is no follow-up on file and none supplied", async () => {
    wire({ report: { analysis: { follow_up_draft: "" } } });
    expect((await POST(req(), { params })).status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("when it cannot send", () => {
  it("names the mailbox problem rather than failing silently", async () => {
    wire();
    mailboxFor.mockResolvedValue({ ok: false, problem: "not_connected" });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).mailboxConnected).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports a send that reached nobody", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    wire();
    sendEmail.mockResolvedValue({ ok: false, detail: "bounced" });
    const res = await POST(req(), { params });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ sent: 0, total: 1 });
    spy.mockRestore();
  });

  it("one bad address does not stop the rest of the room hearing", async () => {
    wire({
      meeting: {
        ...MEETING,
        attendees: [
          { name: "Sarah", email: "sarah@fund.test" },
          { name: "Mike", email: "mike@fund.test" },
        ],
      },
    });
    sendEmail.mockImplementation(async (args: { to: { email: string } }) =>
      args.to.email === "sarah@fund.test" ? Promise.reject(new Error("bad address")) : { ok: true },
    );
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, total: 2 });
  });
});

describe("closing out \"Follow-Up Needed\"", () => {
  // followup_status is set to "draft" by every report that produced an email
  // and was never once set to "done", so the meetings list flagged the meeting
  // forever however diligently the host actually followed up.
  it("marks the meeting done when everyone was reached", async () => {
    wire();
    const res = await POST(req(), { params });
    expect(await res.json()).toMatchObject({ followUpComplete: true });
    expect(updates).toContainEqual({ followup_status: "done" });
  });

  it("leaves it open when somebody was not reached", async () => {
    // A partial send is still outstanding for whoever missed it, and closing it
    // would hide exactly the meetings that still need a person.
    wire({
      meeting: {
        ...MEETING,
        attendees: [
          { name: "Sarah", email: "sarah@fund.test" },
          { name: "Mike", email: "mike@fund.test" },
        ],
      },
    });
    sendEmail.mockImplementation(async (args: { to: { email: string } }) => ({
      ok: args.to.email !== "sarah@fund.test",
    }));
    const res = await POST(req(), { params });
    expect(await res.json()).toMatchObject({ sent: 1, total: 2, followUpComplete: false });
    expect(updates).toEqual([]);
  });

  it("still reports the send when the badge could not be updated", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    wire({ updateError: { message: "denied" } });
    expect((await POST(req(), { params })).status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("lookups", () => {
  it("starts the mailbox lookup without waiting for the stored draft", async () => {
    wire();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const base = from.getMockImplementation()!;
    from.mockImplementation((table: string) => {
      const b = base(table) as Record<string, unknown>;
      if (table === "live_meeting_reports") {
        b.maybeSingle = async () => { await gate; return { data: REPORT, error: null }; };
      }
      return b;
    });

    const pending = POST(req(), { params });
    for (let i = 0; i < 20 && mailboxFor.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(mailboxFor).toHaveBeenCalled();

    release();
    expect((await pending).status).toBe(200);
  });

  it("still answers 409 for a missing draft when the mailbox lookup fails", async () => {
    wire({ report: { analysis: {} } });
    mailboxFor.mockRejectedValue(new Error("google down"));
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
  });
});

describe("who each copy greets", () => {
  it("fills the greeting in with each recipient's own first name", async () => {
    wire({ report: { analysis: { follow_up_draft: "Hi {{first_name}},\n\nGood meeting." } } });
    await POST(req(), { params });
    const html = sendEmail.mock.calls.map((c) => (c[0] as { htmlBody: string }).htmlBody);
    expect(html.some((h) => h.includes("Hi Sarah,"))).toBe(true);
    expect(html.some((h) => h.includes("{{first_name}}"))).toBe(false);
  });

  // A draft written before the prompt named the host, greeting the host, must
  // not go out to everyone else that way.
  it("never sends a greeting addressed to the host", async () => {
    from.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => Object.assign(Promise.resolve({ error: null }), b),
        is: () => b,
        order: () => b,
        limit: () => b,
        update: () => b,
        maybeSingle: async () => ({
          data:
            table === "live_meetings"
              ? MEETING
              : table === "principals"
                ? { full_name: "Alex Rivera", email: "host@fund.test" }
                : { analysis: { follow_up_draft: "Hi Alex,\n\nThanks for your time." } },
          error: null,
        }),
      };
      return b;
    });
    await POST(req(), { params });
    const html = (sendEmail.mock.calls[0][0] as { htmlBody: string }).htmlBody;
    expect(html).toContain("Hi Sarah,");
    expect(html).not.toContain("Hi Alex,");
  });
});

describe("the conversation it starts", () => {
  it("records every copy against the meeting so replies land in the inbox", async () => {
    serviceEnv = true;
    mailboxFor.mockResolvedValue({ ok: true, token: "tok", source: "member", email: "host@fund.test" });
    sendEmail.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent", gmailThreadId: "g1" });
    wire();
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);

    expect(recordFollowUpThreads).toHaveBeenCalledTimes(1);
    const [, input] = recordFollowUpThreads.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input).toMatchObject({
      orgId: "org-1",
      meetingId: "m1",
      hostId: "host-1",
      subject: "Follow-up: Series B sync",
      mailbox: { source: "member", email: "host@fund.test" },
    });
    const sends = input.sends as Array<{ recipient: { email: string }; body: string }>;
    expect(sends.map((x) => x.recipient.email)).toEqual(["sarah@fund.test"]);
    // The personalised text, the same words the attendee received.
    expect(sends[0].body).toContain("Good meeting.");
  });

  it("does not try without a service role to write with", async () => {
    wire();
    await POST(req(), { params });
    expect(recordFollowUpThreads).not.toHaveBeenCalled();
  });
});

describe("when the organisation gates outbound replies", () => {
  beforeEach(() => {
    gated = true;
    ensureMeetingThread.mockResolvedValue({ ok: true, threadId: "thr-1", subject: "Follow-up: Series B sync", continued: false });
    replyToThread.mockResolvedValue({ ok: true, gated: true });
  });

  it("queues one approval per attendee on their meeting thread, and sends nothing", async () => {
    wire();
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gated: true, queued: 1, total: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mailboxFor).toHaveBeenCalled(); // started early, but never awaited for the send
    const [, input] = ensureMeetingThread.mock.calls[0] as [unknown, Record<string, any>];
    expect(input).toMatchObject({ meetingId: "m1", subject: "Follow-up: Series B sync" });
    expect(input.recipient.email).toBe("sarah@fund.test");
    const fd = replyToThread.mock.calls[0][0] as FormData;
    expect(fd.get("thread_id")).toBe("thr-1");
    expect(String(fd.get("body"))).toContain("Good meeting.");
  });

  it("says so when nothing could be queued", async () => {
    replyToThread.mockResolvedValue({ ok: false, error: "x" });
    wire();
    const res = await POST(req(), { params });
    expect(res.status).toBe(502);
    expect(updates).toEqual([]);
  });

  // The page's chip reads followup_status. Left at "draft", a follow-up
  // sitting in approvals read "Not sent", and the host queued it again.
  it("marks the meeting as awaiting approval, so the page's chip says so", async () => {
    wire();
    await POST(req(), { params });
    expect(updates).toContainEqual({ followup_status: "pending_approval" });
    expect(updates).not.toContainEqual({ followup_status: "done" });
  });

  // Known contacts skip the hold (lib/inbox/known-contact.server.ts): those
  // copies went out, and the meeting is not waiting on approvals for them.
  it("counts copies that went straight to known contacts as sent, not queued", async () => {
    replyToThread.mockResolvedValue({ ok: true, gated: false });
    wire();
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gated: true, queued: 0, sent: 1, total: 1 });
    expect(updates).not.toContainEqual({ followup_status: "pending_approval" });
  });

  it("still reports the queue when the badge could not be written", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    wire({ updateError: { message: "denied" } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gated: true, queued: 1 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
