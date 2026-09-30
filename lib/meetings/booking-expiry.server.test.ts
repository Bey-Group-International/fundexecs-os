// Closing booking requests the host never answered, and telling the invitee.
const sendBookingEmailsMock = jest.fn();
const hostCredentialsMock = jest.fn();
const loadBookingByIdMock = jest.fn();

jest.mock("@/lib/meetings/scheduling-email", () => ({
  sendBookingEmails: (...a: unknown[]) => sendBookingEmailsMock(...a),
}));
jest.mock("@/lib/meetings/mailbox.server", () => ({
  hostCredentials: (...a: unknown[]) => hostCredentialsMock(...a),
}));
jest.mock("@/lib/meetings/scheduling-service", () => ({
  loadBookingById: (...a: unknown[]) => loadBookingByIdMock(...a),
}));

import { EXPIRED_REQUEST_REASON, runBookingRequestExpiry } from "./booking-expiry.server";

const NOW = new Date("2026-10-01T12:00:00Z");

function ctx() {
  return {
    booking: {
      id: "bk-1",
      status: "declined",
      invitee_name: "Ada",
      invitee_email: "ada@example.com",
      invitee_timezone: "America/New_York",
      invitee_notes: null,
      starts_at: "2026-10-01T11:00:00.000Z",
      ends_at: "2026-10-01T11:30:00.000Z",
      manage_token: "tok",
      created_at: "2026-09-30T11:00:00.000Z",
      updated_at: "2026-10-01T12:00:00.000Z",
      calendar_sequence: 2,
    },
    page: { slug: "rae", user_id: "host-1", organization_id: "org-1", display_name: "Rae", timezone: "America/New_York" },
    eventType: { title: "Intro", duration_minutes: 30 },
    roomCode: null,
  };
}

/** Answers the lookup from `rows`; records updates; `claimMatches` decides whether the close matched. */
function client(rows: Array<Record<string, unknown>>, opts: { claimMatches?: boolean; lookupError?: boolean } = {}) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Record<string, unknown>) => ((mode = "update"), (patch = p), b),
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: table === "principals" ? { email: "rae@fund.test", full_name: "Rae" } : null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (mode === "update") {
          updates.push({ patch, filters: [...filters] });
          return Promise.resolve({ data: opts.claimMatches === false ? [] : [{ id: "bk-1" }], error: null }).then(res, rej);
        }
        if (opts.lookupError) return Promise.resolve({ data: null, error: { message: "down" } }).then(res, rej);
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { from, updates };
}

beforeEach(() => {
  jest.clearAllMocks();
  hostCredentialsMock.mockResolvedValue({ kind: "gmail" });
  loadBookingByIdMock.mockResolvedValue(ctx());
  sendBookingEmailsMock.mockResolvedValue({ sent: 1, inviteeSent: true });
});

it("closes a request whose time came unanswered, and tells the invitee", async () => {
  const c = client([{ id: "bk-1", starts_at: "2026-10-01T11:00:00.000Z" }]);
  const stats = await runBookingRequestExpiry(c as never, { now: NOW });

  expect(stats).toEqual({ expired: 1, notified: 1, failed: 0 });
  expect(c.updates[0].patch).toMatchObject({ status: "declined", cancellation_reason: EXPIRED_REQUEST_REASON });
  // Only a request still pending is closed, so a host approving at that moment wins.
  expect(c.updates[0].filters).toContainEqual(["status", "pending"]);

  const [kind, context, opts] = sendBookingEmailsMock.mock.calls[0];
  expect(kind).toBe("declined");
  expect(context).toMatchObject({ reason: EXPIRED_REQUEST_REASON, manageToken: null, inviteeEmail: "ada@example.com" });
  // Back to the booking page, already knowing who they are.
  expect(context.manageUrl).toMatch(/\/book\/rae\?name=Ada&email=ada%40example.com$/);
  expect(opts).toEqual({ inviteeOnly: true });
});

it("closes a long-expired request without emailing about it", async () => {
  const c = client([{ id: "bk-1", starts_at: "2026-09-20T11:00:00.000Z" }]);
  const stats = await runBookingRequestExpiry(c as never, { now: NOW });
  expect(stats).toEqual({ expired: 1, notified: 0, failed: 0 });
  expect(sendBookingEmailsMock).not.toHaveBeenCalled();
});

it("does nothing more when the host decided first", async () => {
  const c = client([{ id: "bk-1", starts_at: "2026-10-01T11:00:00.000Z" }], { claimMatches: false });
  const stats = await runBookingRequestExpiry(c as never, { now: NOW });
  expect(stats).toEqual({ expired: 0, notified: 0, failed: 0 });
  expect(sendBookingEmailsMock).not.toHaveBeenCalled();
});

it("counts an email that did not reach the invitee as a failure", async () => {
  sendBookingEmailsMock.mockResolvedValue({ sent: 0, inviteeSent: false });
  const c = client([{ id: "bk-1", starts_at: "2026-10-01T11:00:00.000Z" }]);
  expect(await runBookingRequestExpiry(c as never, { now: NOW })).toEqual({ expired: 1, notified: 0, failed: 1 });
});

it("never throws, even when the lookup fails", async () => {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const c = client([], { lookupError: true });
  await expect(runBookingRequestExpiry(c as never, { now: NOW })).resolves.toEqual({ expired: 0, notified: 0, failed: 0 });
  errorSpy.mockRestore();
});
