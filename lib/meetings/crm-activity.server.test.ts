// lib/meetings/crm-activity.server.test.ts
// The database side of putting a meeting on a contact's record.
//
// The rules are in crm-activity.test.ts. What is left here is what only a client
// can show: that the contact lookup is ONE query rather than one per attendee,
// that the write upserts on the key the migration creates, and that nothing here
// can take down the report the host is actually waiting on.
jest.mock("next/headers", () => ({ cookies: () => ({ getAll: () => [], set: () => undefined }) }));

import {
  MEETING_CONFLICT_TARGET,
  inviteList,
  recordMeetingOnTimelines,
  type MeetingForCrm,
} from "./crm-activity.server";

const MEETING: MeetingForCrm = {
  id: "m1",
  organizationId: "org-1",
  roomCode: "abc-def-gh",
  title: "Dunbar follow-up",
  startedAt: "2026-09-23T14:00:00.000Z",
  scheduledAt: null,
  attendees: [{ name: "Ana Diaz", email: "ana@acme.com" }],
  hostEmail: "host@fundexecs.test",
};

const REPORT = { summary: "Walked the pacing.", decisions: ["Send the LPA"] };

interface Recorded {
  table: string;
  /** Column → value for every .eq()/.in() in the chain. */
  filters: Array<[string, unknown]>;
  upserted?: { rows: Array<Record<string, unknown>>; onConflict: string };
}

/**
 * A client that records every query and answers from `rows`.
 *
 * Deliberately records the FILTERS too: "the lookup is scoped to the
 * organisation" is a claim about a where clause, and a test that only counted
 * queries would pass with the scope dropped.
 */
function fakeClient(
  rows: Record<string, unknown[]>,
  opts: { failOn?: string; throwOn?: string } = {},
) {
  const calls: Recorded[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        if (opts.throwOn === table) throw new Error(`boom on ${table}`);
        const record: Recorded = { table, filters: [] };
        calls.push(record);
        const error = opts.failOn === table ? { message: `failed on ${table}` } : null;
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            record.filters.push([column, value]);
            return builder;
          },
          in: (column: string, values: unknown) => {
            record.filters.push([column, values]);
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error }),
          upsert: async (payload: Array<Record<string, unknown>>, options: { onConflict: string }) => {
            record.upserted = { rows: payload, onConflict: options.onConflict };
            return { error };
          },
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: rows[table] ?? [], error }).then(resolve),
        };
        return builder;
      },
    },
  };
}

// `email_lower` is what the lookup selects and filters on, because
// network_contacts.email holds whatever case it was given.
const CONTACT_ANA = { id: "contact-ana", email_lower: "ana@acme.com" };

function run(
  rows: Record<string, unknown[]>,
  opts: Parameters<typeof fakeClient>[1] = {},
  over: Partial<Parameters<typeof recordMeetingOnTimelines>[1]> = {},
) {
  const { client, calls } = fakeClient(rows, opts);
  return {
    calls,
    result: recordMeetingOnTimelines(client as never, {
      meeting: MEETING,
      actorId: "principal-host",
      endedAt: "2026-09-23T14:40:00.000Z",
      durationMinutes: 40,
      report: REPORT,
      ...over,
    }),
  };
}

describe("recordMeetingOnTimelines", () => {
  it("writes one row for the contact who was in the meeting", async () => {
    const { calls, result } = run({
      network_contacts: [CONTACT_ANA],
      live_meeting_participants: [{ user_id: null, display_name: "Ana Diaz" }],
    });
    expect(await result).toEqual({ written: 1, failed: false });

    const write = calls.find((c) => c.upserted);
    expect(write?.table).toBe("network_activities");
    expect(write?.upserted?.rows).toHaveLength(1);
    const row = write!.upserted!.rows[0];
    expect(row.contact_id).toBe("contact-ana");
    expect(row.organization_id).toBe("org-1");
    expect(row.actor_id).toBe("principal-host");
    expect(row.activity_type).toBe("meeting");
    expect(row.is_system).toBe(true);
    expect(row.occurred_at).toBe("2026-09-23T14:00:00.000Z");
    expect(String(row.body)).toContain("Walked the pacing.");
  });

  /**
   * The guard the whole feature rests on.
   *
   * The report path runs more than once — the room retries, and
   * /report/regenerate exists to run the analysis again. Without a usable upsert
   * key, a regenerate adds a second copy of one meeting to somebody's permanent
   * record.
   *
   * THIS TEST USED TO BE WORTHLESS, and it is worth saying why. It asserted the
   * conflict target equalled the string this file's own migration named — so when
   * both were `(metadata->>'meeting_id')`, it passed, while every upsert in
   * production would have failed with "there is no unique or exclusion
   * constraint matching the ON CONFLICT specification". An oracle that compares
   * code against the same assumption the code was written from checks nothing.
   *
   * So it now asserts the property PostgREST imposes, which is external to both:
   * on_conflict carries a comma-separated list of COLUMN NAMES. No parentheses,
   * no operators, no whitespace. That fails for an expression whatever the
   * migration says.
   */
  it("upserts on a conflict target PostgREST can actually carry", async () => {
    const { calls, result } = run({ network_contacts: [CONTACT_ANA], live_meeting_participants: [] });
    await result;
    const target = calls.find((c) => c.upserted)!.upserted!.onConflict;

    expect(target).toBe(MEETING_CONFLICT_TARGET);
    const columns = target.split(",");
    expect(columns.length).toBeGreaterThan(1);
    for (const column of columns) {
      // A plain identifier. An expression — `(metadata->>'x')`, `lower(email)` —
      // fails here, which is exactly what PostgREST does with it.
      expect(column).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
    // And every column named in the key is one the payload actually sets, or is
    // generated from something it sets.
    const row = calls.find((c) => c.upserted)!.upserted!.rows[0];
    expect(row.organization_id).toBeDefined();
    expect(row.contact_id).toBeDefined();
    expect((row.metadata as { meeting_id: string }).meeting_id).toBe("m1");
  });

  // A meeting can have two hundred people in it. One query, not two hundred.
  it("resolves every contact in one query, scoped to the organisation", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ email: `p${i}@acme.com` }));
    const { calls, result } = run(
      { network_contacts: [CONTACT_ANA], live_meeting_participants: [] },
      {},
      { meeting: { ...MEETING, attendees: many } },
    );
    await result;

    const lookups = calls.filter((c) => c.table === "network_contacts");
    expect(lookups).toHaveLength(1);
    expect(lookups[0].filters).toContainEqual(["organization_id", "org-1"]);
    const inFilter = lookups[0].filters.find(([col]) => col === "email_lower");
    expect((inFilter?.[1] as string[]).length).toBe(40);
    // Never the raw column: it holds mixed case, so comparing lowercased
    // addresses against it silently misses contacts.
    expect(lookups[0].filters.some(([col]) => col === "email")).toBe(false);
  });

  it("does not look up contacts at all when the meeting has no addresses", async () => {
    const { calls, result } = run(
      { network_contacts: [CONTACT_ANA], live_meeting_participants: [] },
      {},
      { meeting: { ...MEETING, attendees: [] } },
    );
    expect(await result).toEqual({ written: 0, failed: false });
    expect(calls.filter((c) => c.table === "network_contacts")).toHaveLength(0);
  });

  it("writes nothing when nobody in the meeting is a contact", async () => {
    const { calls, result } = run({ network_contacts: [], live_meeting_participants: [] });
    expect(await result).toEqual({ written: 0, failed: false });
    expect(calls.some((c) => c.upserted)).toBe(false);
  });

  // Activities are scoped to an organisation by a NOT NULL column, so a meeting
  // without one has no CRM to write to. Not a failure.
  it("does nothing for a meeting with no organisation", async () => {
    const { calls, result } = run(
      { network_contacts: [CONTACT_ANA] },
      {},
      { meeting: { ...MEETING, organizationId: null } },
    );
    expect(await result).toEqual({ written: 0, failed: false });
    expect(calls).toHaveLength(0);
  });

  describe("never takes the report down with it", () => {
    it("reports a failed write rather than throwing", async () => {
      const { result } = run(
        { network_contacts: [CONTACT_ANA], live_meeting_participants: [] },
        { failOn: "network_activities" },
      );
      expect(await result).toEqual({ written: 0, failed: true });
    });

    it("survives a client that throws", async () => {
      const { result } = run(
        { network_contacts: [CONTACT_ANA] },
        { throwOn: "network_contacts" },
      );
      expect(await result).toEqual({ written: 0, failed: true });
    });

    it("writes nothing rather than guessing when the contact lookup fails", async () => {
      const { calls, result } = run(
        { network_contacts: [CONTACT_ANA], live_meeting_participants: [] },
        { failOn: "network_contacts" },
      );
      expect(await result).toEqual({ written: 0, failed: false });
      expect(calls.some((c) => c.upserted)).toBe(false);
    });
  });

  it("records a meeting that produced no report, so the timeline is not silently short", async () => {
    const { calls, result } = run(
      { network_contacts: [CONTACT_ANA], live_meeting_participants: [] },
      {},
      { report: null },
    );
    expect(await result).toEqual({ written: 1, failed: false });
    const row = calls.find((c) => c.upserted)!.upserted!.rows[0];
    expect((row.metadata as { has_report: boolean }).has_report).toBe(false);
  });

  it("marks a booking-link meeting as inbound", async () => {
    const { calls, result } = run({
      network_contacts: [CONTACT_ANA],
      live_meeting_participants: [],
      scheduling_bookings: [{ id: "b1" }],
    });
    await result;
    expect(calls.find((c) => c.upserted)!.upserted!.rows[0].direction).toBe("inbound");
  });

  it("marks a meeting the host convened as outbound", async () => {
    const { calls, result } = run({
      network_contacts: [CONTACT_ANA],
      live_meeting_participants: [],
      scheduling_bookings: [],
    });
    await result;
    expect(calls.find((c) => c.upserted)!.upserted!.rows[0].direction).toBe("outbound");
  });
});

/**
 * `live_meetings.attendees` is jsonb written by several paths over this
 * product's life, so it is narrowed rather than cast. A malformed entry costs
 * that one attendee, not the whole write.
 */
describe("inviteList", () => {
  it("keeps the entries that have a name and an address", () => {
    expect(inviteList([{ name: "Ana", email: "ana@acme.com" }])).toEqual([
      { name: "Ana", email: "ana@acme.com" },
    ]);
  });

  it("survives anything that is not an attendee list", () => {
    for (const bad of [null, undefined, "", 0, {}, "ana@acme.com"]) {
      expect(inviteList(bad)).toEqual([]);
    }
  });

  it("drops malformed entries and keeps the rest", () => {
    expect(inviteList([null, 7, "x", { email: "ana@acme.com" }, { name: 5, email: 6 }])).toEqual([
      { name: null, email: "ana@acme.com" },
      { name: null, email: null },
    ]);
  });
});

/**
 * A contact stored with a capitalised address is still that contact.
 *
 * The lookup filters on the generated `email_lower` column, so the case the
 * address was typed in — by whoever imported the contact, or whoever sent the
 * invite — cannot decide whether a meeting reaches their record.
 */
describe("matching a contact whose address was stored capitalised", () => {
  it("finds them, because the lookup compares lowercased values on both sides", async () => {
    const { calls, result } = run(
      // What the database answers with for `email_lower` is always lowercase; the
      // point is that the FILTER is on that column rather than on `email`.
      { network_contacts: [{ id: "contact-ana", email_lower: "ana@acme.com" }], live_meeting_participants: [] },
      {},
      { meeting: { ...MEETING, attendees: [{ name: "Ana", email: "Ana@Acme.COM" }] } },
    );
    expect(await result).toEqual({ written: 1, failed: false });
    const lookup = calls.find((c) => c.table === "network_contacts")!;
    expect(lookup.filters).toContainEqual(["email_lower", ["ana@acme.com"]]);
  });
});
