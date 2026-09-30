// Reminding the host once about a request still waiting on them.
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

import { runBookingRequestReminders } from "./booking-request-reminder.server";

const NOW = new Date("2026-10-01T12:00:00Z");

function ctx(status = "pending") {
  return {
    booking: {
      id: "bk-1",
      status,
      invitee_name: "Ada",
      invitee_email: "ada@example.com",
      invitee_timezone: "UTC",
      invitee_notes: null,
      invitee_guests: [],
      starts_at: "2026-10-02T09:00:00.000Z",
      ends_at: "2026-10-02T09:30:00.000Z",
      manage_token: "tok",
      created_at: "2026-09-30T11:00:00.000Z",
      updated_at: "2026-09-30T11:00:00.000Z",
      calendar_sequence: 0,
    },
    page: { slug: "rae", user_id: "host-1", organization_id: "org-1", display_name: "Rae", timezone: "UTC" },
    eventType: { title: "Intro", duration_minutes: 30 },
    roomCode: null,
  };
}

function client(rows: Array<Record<string, unknown>>, opts: { claimMatches?: boolean; lookupError?: boolean } = {}) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const reads: Array<Array<[string, unknown]>> = [];
  const from = (table: string) => {
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Record<string, unknown>) => ((mode = "update"), (patch = p), b),
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      is: (c: string, v: unknown) => (filters.push([`is:${c}`, v]), b),
      gt: (c: string, v: unknown) => (filters.push([`gt:${c}`, v]), b),
      lte: (c: string, v: unknown) => (filters.push([`lte:${c}`, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: table === "principals" ? { email: "rae@fund.test", full_name: "Rae" } : null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (mode === "update") {
          updates.push({ patch, filters: [...filters] });
          return Promise.resolve({ data: opts.claimMatches === false ? [] : [{ id: "bk-1" }], error: null }).then(res, rej);
        }
        if (table === "scheduling_bookings") reads.push([...filters]);
        if (opts.lookupError) return Promise.resolve({ data: null, error: { message: "down" } }).then(res, rej);
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { from, updates, reads };
}

beforeEach(() => {
  jest.clearAllMocks();
  hostCredentialsMock.mockResolvedValue({ kind: "gmail" });
  loadBookingByIdMock.mockResolvedValue(ctx());
  sendBookingEmailsMock.mockResolvedValue({ sent: 1, inviteeSent: false });
});

it("reminds the host once about a request due within a day", async () => {
  const c = client([{ id: "bk-1" }]);
  expect(await runBookingRequestReminders(c as never, { now: NOW })).toEqual({ reminded: 1, failed: 0 });

  // Only pending, never-reminded requests starting in the next 24 hours.
  expect(c.reads[0]).toEqual(
    expect.arrayContaining([
      ["status", "pending"],
      ["is:host_reminded_at", null],
      ["gt:starts_at", NOW.toISOString()],
      ["lte:starts_at", "2026-10-02T12:00:00.000Z"],
    ]),
  );
  // Stamped only while still unstamped and pending, so it happens once.
  expect(c.updates[0].patch).toEqual({ host_reminded_at: NOW.toISOString() });
  expect(c.updates[0].filters).toEqual(expect.arrayContaining([["is:host_reminded_at", null], ["status", "pending"]]));
  expect(sendBookingEmailsMock).toHaveBeenCalledWith("request_reminder", expect.objectContaining({ inviteeName: "Ada" }));
});

it("does nothing when another sweep already reminded", async () => {
  const c = client([{ id: "bk-1" }], { claimMatches: false });
  expect(await runBookingRequestReminders(c as never, { now: NOW })).toEqual({ reminded: 0, failed: 0 });
  expect(sendBookingEmailsMock).not.toHaveBeenCalled();
});

it("skips a request the host decided in the meantime", async () => {
  loadBookingByIdMock.mockResolvedValue(ctx("confirmed"));
  const c = client([{ id: "bk-1" }]);
  expect(await runBookingRequestReminders(c as never, { now: NOW })).toEqual({ reminded: 0, failed: 0 });
  expect(sendBookingEmailsMock).not.toHaveBeenCalled();
});

it("counts an email that went nowhere as a failure", async () => {
  sendBookingEmailsMock.mockResolvedValue({ sent: 0, inviteeSent: false });
  const c = client([{ id: "bk-1" }]);
  expect(await runBookingRequestReminders(c as never, { now: NOW })).toEqual({ reminded: 0, failed: 1 });
});

it("never throws, even when the lookup fails", async () => {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const c = client([], { lookupError: true });
  await expect(runBookingRequestReminders(c as never, { now: NOW })).resolves.toEqual({ reminded: 0, failed: 0 });
  errorSpy.mockRestore();
});
