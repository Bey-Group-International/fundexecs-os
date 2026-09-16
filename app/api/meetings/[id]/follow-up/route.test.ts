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

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
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
