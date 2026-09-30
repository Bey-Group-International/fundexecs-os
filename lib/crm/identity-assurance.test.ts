// lib/crm/identity-assurance.test.ts
// Telling a link the app OBSERVED from one a sender ASSERTED.
//
// The distinction exists because `is_system` conflates them: it says the engine
// wrote the row, and a reader takes that to mean the engine knew what it was
// doing. For a meeting it did — the host built the invite list, or the app
// watched the person join. For an inbound email it did not: the address is the
// From header, written by whoever sent the message.
//
// So the tests that matter here are the two ends of the pipe. The inbox writer's
// own output must read as asserted, and the meetings writer's own output must
// not — asserted against the writers' real return values rather than against a
// string literal copied into the test, because a marker only works if the
// producer and the consumer agree on it.
import { meetingActivities, type CrmMeetingInput } from "@/lib/meetings/crm-activity";
import { threadActivity } from "@/lib/inbox/crm-activity";
import { IDENTITY_ASSERTED, IDENTITY_KEY, identityIsAsserted } from "./identity-assurance";

describe("identityIsAsserted", () => {
  it("is true only for the exact marker", () => {
    expect(identityIsAsserted({ [IDENTITY_KEY]: IDENTITY_ASSERTED })).toBe(true);
  });

  /**
   * Strict on purpose. Absence means an older row or an observed one, and
   * treating a near-miss value as a claim about provenance would be inventing
   * provenance. metadata is free-form jsonb, so every shape has to be survivable.
   */
  it("is false for anything else, including shapes jsonb allows", () => {
    for (const metadata of [
      {},
      { identity: "verified" },
      { identity: "Asserted" },
      { identity: "asserted " },
      { identity: true },
      { identity: null },
      { identity: ["asserted"] },
      { source: "inbox_thread" },
      null,
      undefined,
      "asserted",
      42,
      ["asserted"],
      [{ identity: "asserted" }],
    ]) {
      expect(identityIsAsserted(metadata)).toBe(false);
    }
  });
});

describe("what each writer's rows claim", () => {
  // Every inbox channel asserts: an email's From header is written by the
  // sender, and a booking form's address is typed by whoever filled it in.
  it("every row the inbox writer produces reads as asserted", () => {
    for (const channel of ["gmail", "slack", "calendly", "zoom", "docusign", "a_new_provider"]) {
      const row = threadActivity({
        thread: {
          id: "t1",
          channel,
          subject: "Q3 pacing",
          counterpartyEmail: "ana@acme.com",
          aiSummary: "Ana asked for the pacing model.",
          preview: null,
          lastMessageAt: "2026-09-23T14:00:00.000Z",
        },
        contactsByEmail: new Map([["ana@acme.com", "contact-ana"]]),
        now: "2026-09-30T08:00:00.000Z",
      });
      expect(row).not.toBeNull();
      expect(identityIsAsserted(row!.metadata)).toBe(true);
    }
  });

  /**
   * And the meetings writer's rows must NOT, or the marker says nothing.
   *
   * A meeting's attendance is observed: the invite list was built inside the app
   * by the host, and the room recorded who joined. Marking those "sender
   * unverified" would train a reader to ignore the words on the rows where they
   * are true.
   */
  it("no row the meetings writer produces reads as asserted", () => {
    const input: CrmMeetingInput = {
      meeting: {
        id: "m1",
        roomCode: "abc-def-gh",
        title: "Dunbar follow-up",
        startedAt: "2026-09-23T14:00:00.000Z",
        scheduledAt: "2026-09-23T13:55:00.000Z",
        endedAt: "2026-09-23T14:40:00.000Z",
        durationMinutes: 40,
        hostEmail: "host@fundexecs.test",
        fromBookingLink: false,
      },
      invited: [{ name: "Ana Diaz", email: "ana@acme.com" }],
      attendedEmails: ["ana@acme.com"],
      contactsByEmail: new Map([["ana@acme.com", "contact-ana"]]),
      report: { summary: "Walked the pacing.", decisions: [] },
      siteUrl: "https://app.test",
    };
    const rows = meetingActivities(input);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(identityIsAsserted(row.metadata)).toBe(false);
    }
  });
});
