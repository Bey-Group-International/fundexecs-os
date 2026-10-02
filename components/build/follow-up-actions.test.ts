jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let ctx: { orgId: string; role: string; userId: string } | null;
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
const inserted: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "data_rooms" ? { id: "room-1", name: "Fund II" } : table === "principals" ? { full_name: "Sam Lee" } : null,
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  }),
}));
jest.mock("@/lib/data-room-engagement.server", () => ({
  loadRoomEngagement: async () => ({
    engagement: {
      investors: [
        { key: "email:jane@fund.com", email: "jane@fund.com", documents: [], downloads: 0, timeline: [] },
        { key: "visitor:b1", email: null, documents: [], downloads: 0, timeline: [] },
      ],
    },
    reads: new Map([["email:jane@fund.com", { follow_up: "Offer a call.", summary: "Keen." }]]),
  }),
}));
const logFollowUpOnTimeline = jest.fn(async () => undefined);
jest.mock("@/lib/data-room-crm.server", () => ({
  crmMatches: async () => new Map([["jane@fund.com", { contactId: "c1", contactName: "Jane Doe", investorId: null, investorName: null }]]),
  draftFollowUp: async () => ({ subject: "Fund II", body: "Hi Jane", source: "earn" }),
  logFollowUpOnTimeline: (...a: unknown[]) => logFollowUpOnTimeline(...(a as [])),
}));
let mailbox: { ok: boolean; token?: string } = { ok: true, token: "tok" };
jest.mock("@/lib/meetings/mailbox.server", () => ({ mailboxFor: async () => mailbox }));
const sendEmail = jest.fn(async () => ({ ok: true, channel: "gmail", detail: "" }));
jest.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) }));

import { draftInvestorFollowUp, sendInvestorFollowUp } from "./follow-up-actions";

beforeEach(() => {
  ctx = { orgId: "org-1", role: "admin", userId: "u1" };
  mailbox = { ok: true, token: "tok" };
  inserted.length = 0;
  sendEmail.mockClear();
  logFollowUpOnTimeline.mockClear();
});

it("drafts for a reader of the room, addressed to their gate email", async () => {
  expect(await draftInvestorFollowUp("room-1", "email:jane@fund.com")).toEqual({
    ok: true,
    to: "jane@fund.com",
    draft: { subject: "Fund II", body: "Hi Jane", source: "earn" },
  });
});

it("sends the edited text from the member's mailbox, logs it and puts it on their record", async () => {
  expect(await sendInvestorFollowUp("room-1", "email:jane@fund.com", " Fund II terms ", "Hi <Jane>")).toEqual({ ok: true });
  expect(sendEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      orgId: "org-1",
      credentials: { gmailAccessToken: "tok" },
      to: { name: "", email: "jane@fund.com" },
      subject: "Fund II terms",
      htmlBody: expect.stringContaining("Hi &lt;Jane&gt;"),
    }),
  );
  expect(inserted).toEqual([
    expect.objectContaining({ table: "data_room_follow_ups", viewer_key: "email:jane@fund.com", recipient_email: "jane@fund.com", sent_by: "u1" }),
  ]);
  expect(logFollowUpOnTimeline).toHaveBeenCalledWith(
    expect.anything(),
    "org-1",
    expect.objectContaining({ contactId: "c1" }),
    expect.objectContaining({ subject: "Fund II terms", roomId: "room-1" }),
  );
});

it("never mails an address that didn't read this room", async () => {
  expect(await sendInvestorFollowUp("room-1", "email:attacker-target@x.com", "Hi", "Spam")).toEqual({
    ok: false,
    error: "That reader isn't in this room's activity.",
  });
  expect(await sendInvestorFollowUp("room-1", "visitor:b1", "Hi", "x")).toEqual({
    ok: false,
    error: "Only a reader who gave an email can be followed up.",
  });
  expect(sendEmail).not.toHaveBeenCalled();
});

it("refuses view-only members and says how to connect a mailbox", async () => {
  ctx = { orgId: "org-1", role: "viewer", userId: "u1" };
  expect((await sendInvestorFollowUp("room-1", "email:jane@fund.com", "Hi", "x")).ok).toBe(false);
  ctx = { orgId: "org-1", role: "admin", userId: "u1" };
  mailbox = { ok: false };
  const res = await sendInvestorFollowUp("room-1", "email:jane@fund.com", "Hi", "x");
  expect(res).toEqual({ ok: false, error: expect.stringContaining("Settings › Integrations") });
  expect(sendEmail).not.toHaveBeenCalled();
});

it("logs nothing when Google refuses the send", async () => {
  sendEmail.mockResolvedValueOnce({ ok: false, channel: "in-app", detail: "x" });
  expect((await sendInvestorFollowUp("room-1", "email:jane@fund.com", "Hi", "x")).ok).toBe(false);
  expect(inserted).toEqual([]);
  expect(logFollowUpOnTimeline).not.toHaveBeenCalled();
});

it("needs a subject and a message", async () => {
  expect(await sendInvestorFollowUp("room-1", "email:jane@fund.com", " ", "x")).toEqual({ ok: false, error: "Add a subject and a message." });
});
