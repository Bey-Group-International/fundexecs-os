// The confirmation an invitee gets after booking through a public link, and the
// retry that re-sends it when the first attempt reached nobody.
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

import {
  CONFIRMATION_RETRY_MAX_ATTEMPTS,
  runBookingConfirmationRetries,
  sendBookingConfirmation,
} from "./booking-confirmation.server";

const NOW = new Date("2026-10-01T12:00:00Z");

function bookingCtx(over: Record<string, unknown> = {}) {
  return {
    booking: {
      id: "bk-1",
      status: "confirmed",
      invitee_name: "Ada",
      invitee_email: "ada@example.com",
      invitee_timezone: "America/New_York",
      invitee_notes: null,
      starts_at: "2026-10-02T15:00:00.000Z",
      ends_at: "2026-10-02T15:30:00.000Z",
      manage_token: "tok",
      created_at: "2026-10-01T11:00:00.000Z",
      updated_at: "2026-10-01T11:00:00.000Z",
      calendar_sequence: 1,
      ...over,
    },
    page: { user_id: "host-1", organization_id: "org-1", display_name: "Rae", timezone: "America/New_York" },
    eventType: { title: "Intro", duration_minutes: 30 },
    roomCode: "abc-defg-hij",
  };
}

/**
 * A chainable stand-in that answers reads from `rows`, records every update,
 * and lets a test decide whether an update matched (the sweep's claim).
 */
function client(rows: Array<Record<string, unknown>>, opts: { claimMatches?: boolean } = {}) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      in: () => b,
      gt: () => b,
      lt: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: table === "principals" ? { email: "rae@fund.test", full_name: "Rae" } : null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (mode === "update") {
          updates.push({ patch, filters: [...filters] });
          const matched = opts.claimMatches === false && "confirmation_email_attempts" in patch ? [] : [{ id: "bk-1" }];
          return Promise.resolve({ data: matched, error: null }).then(res, rej);
        }
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { client: { from } as never, updates };
}

beforeEach(() => {
  jest.clearAllMocks();
  hostCredentialsMock.mockResolvedValue({ gmailAccessToken: "tok" });
  sendBookingEmailsMock.mockResolvedValue({ sent: 2, inviteeSent: true });
});

describe("sendBookingConfirmation", () => {
  it("builds the confirmation from the booking, and says which kind it is", async () => {
    const { client: c } = client([]);
    await sendBookingConfirmation(c, bookingCtx() as never);
    const [kind, ctx] = sendBookingEmailsMock.mock.calls[0];
    expect(kind).toBe("confirmed");
    expect(ctx).toMatchObject({
      inviteeEmail: "ada@example.com",
      hostEmail: "rae@fund.test",
      hostName: "Rae",
      startIso: "2026-10-02T15:00:00.000Z",
      manageToken: "tok",
      bookingSequence: 1,
      orgId: "org-1",
    });
    expect(ctx.joinUrl).toContain("/meeting-invite/abc-defg-hij");

    await sendBookingConfirmation(c, bookingCtx({ status: "pending" }) as never);
    expect(sendBookingEmailsMock.mock.calls[1][0]).toBe("requested");
  });

  it("marks the booking for a retry when the invitee's copy didn't go out", async () => {
    sendBookingEmailsMock.mockResolvedValue({ sent: 1, inviteeSent: false });
    const { client: c, updates } = client([]);
    const result = await sendBookingConfirmation(c, bookingCtx() as never);
    expect(result.inviteeSent).toBe(false);
    expect(updates).toEqual([
      { patch: { confirmation_email_pending: true }, filters: [["id", "bk-1"]] },
    ]);
  });

  it("marks nothing when it arrived", async () => {
    const { client: c, updates } = client([]);
    await sendBookingConfirmation(c, bookingCtx() as never);
    expect(updates).toEqual([]);
  });
});

describe("runBookingConfirmationRetries", () => {
  const flagged = { id: "bk-1", confirmation_email_attempts: 2 };

  it("re-sends only the invitee's copy and clears the flag once it arrives", async () => {
    loadBookingByIdMock.mockResolvedValue(bookingCtx());
    const { client: c, updates } = client([flagged]);

    const stats = await runBookingConfirmationRetries(c, { now: NOW });

    expect(stats).toEqual({ due: 1, delivered: 1, failed: 0 });
    expect(sendBookingEmailsMock).toHaveBeenCalledWith("confirmed", expect.anything(), { inviteeOnly: true });
    // Claimed by bumping the attempt count from the value it read…
    expect(updates[0]).toEqual({
      patch: { confirmation_email_attempts: 3 },
      filters: [["id", "bk-1"], ["confirmation_email_attempts", 2]],
    });
    // …and released once delivered.
    expect(updates[1].patch).toEqual({ confirmation_email_pending: false });
  });

  it("leaves the flag for the next sweep when it fails again", async () => {
    loadBookingByIdMock.mockResolvedValue(bookingCtx());
    sendBookingEmailsMock.mockResolvedValue({ sent: 0, inviteeSent: false });
    const { client: c, updates } = client([flagged]);

    const stats = await runBookingConfirmationRetries(c, { now: NOW });

    expect(stats).toEqual({ due: 1, delivered: 0, failed: 1 });
    expect(updates).toHaveLength(1); // the claim only
  });

  it("gives up on the last attempt rather than retrying forever", async () => {
    loadBookingByIdMock.mockResolvedValue(bookingCtx());
    sendBookingEmailsMock.mockResolvedValue({ sent: 0, inviteeSent: false });
    const { client: c, updates } = client([{ id: "bk-1", confirmation_email_attempts: CONFIRMATION_RETRY_MAX_ATTEMPTS - 1 }]);

    await runBookingConfirmationRetries(c, { now: NOW });

    expect(updates.at(-1)!.patch).toEqual({ confirmation_email_pending: false });
  });

  it("does nothing when another sweep claimed the row first", async () => {
    loadBookingByIdMock.mockResolvedValue(bookingCtx());
    const { client: c } = client([flagged], { claimMatches: false });

    const stats = await runBookingConfirmationRetries(c, { now: NOW });

    expect(sendBookingEmailsMock).not.toHaveBeenCalled();
    expect(stats.due).toBe(0);
  });

  it("drops the flag on a booking that is no longer live", async () => {
    loadBookingByIdMock.mockResolvedValue(bookingCtx({ status: "cancelled" }));
    const { client: c, updates } = client([flagged]);

    await runBookingConfirmationRetries(c, { now: NOW });

    expect(sendBookingEmailsMock).not.toHaveBeenCalled();
    expect(updates.at(-1)!.patch).toEqual({ confirmation_email_pending: false });
  });

  it("never throws, whatever a row does", async () => {
    loadBookingByIdMock.mockRejectedValue(new Error("db"));
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const { client: c } = client([flagged]);
    await expect(runBookingConfirmationRetries(c, { now: NOW })).resolves.toMatchObject({ failed: 1 });
    err.mockRestore();
  });
});
