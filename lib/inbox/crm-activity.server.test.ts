// lib/inbox/crm-activity.server.test.ts
// The database side of putting an inbox conversation on a contact's record.
//
// The rules are in crm-activity.test.ts. What is left here is what only a client
// can show: that the upsert key is one Postgres and PostgREST will both accept,
// that the lookup reads the column that is actually maintained, and that nothing
// on this path can take down an ingest — it is a webhook, and a failed ingest is
// a provider retry and, eventually, a lost message.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { THREAD_CONFLICT_TARGET, recordThreadOnTimeline } from "./crm-activity.server";
import type { InboxThreadForCrm } from "./crm-activity";

const THREAD: InboxThreadForCrm = {
  id: "thr-1",
  channel: "gmail",
  subject: "Q3 pacing",
  counterpartyEmail: "Ana@Acme.com",
  aiSummary: "Ana asked for the updated pacing model.",
  preview: "Hi — could you send over the pacing model?",
  lastMessageAt: "2026-09-23T14:00:00.000Z",
};

interface Recorded {
  table: string;
  /** Column → value for every .eq() in the chain, so a dropped scope fails. */
  filters: Array<[string, unknown]>;
  upserted?: { rows: Array<Record<string, unknown>>; onConflict: string };
}

function fakeClient(
  rows: Record<string, unknown>,
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
          limit: () => builder,
          maybeSingle: async () => ({ data: rows[table] ?? null, error }),
          upsert: async (payload: Array<Record<string, unknown>>, options: { onConflict: string }) => {
            record.upserted = { rows: payload, onConflict: options.onConflict };
            return { error };
          },
        };
        return builder;
      },
    },
  };
}

// `email_lower` is what the lookup selects on, because network_contacts.email
// holds whatever case it was given.
const CONTACT = { network_contacts: { id: "contact-ana" } };

function run(
  rows: Record<string, unknown>,
  opts: Parameters<typeof fakeClient>[1] = {},
  over: Partial<Parameters<typeof recordThreadOnTimeline>[1]> = {},
) {
  const { client, calls } = fakeClient(rows, opts);
  return {
    calls,
    result: recordThreadOnTimeline(client as never, {
      orgId: "org-1",
      thread: THREAD,
      actorId: null,
      now: "2026-09-30T08:00:00.000Z",
      ...over,
    }),
  };
}

describe("recordThreadOnTimeline", () => {
  it("writes one row against the contact on the other end", async () => {
    const { calls, result } = run(CONTACT);
    expect(await result).toEqual({ written: 1, failed: false });

    const write = calls.find((c) => c.upserted)!;
    expect(write.table).toBe("network_activities");
    expect(write.upserted!.rows).toHaveLength(1);
    const row = write.upserted!.rows[0];
    expect(row.organization_id).toBe("org-1");
    expect(row.contact_id).toBe("contact-ana");
    expect(row.activity_type).toBe("email");
    expect(row.is_system).toBe(true);
    expect(row.occurred_at).toBe("2026-09-23T14:00:00.000Z");
    expect((row.metadata as { thread_id: string }).thread_id).toBe("thr-1");
  });

  /**
   * The guard the whole feature rests on, and the one that shipped broken on the
   * meetings side of this: PostgREST's on_conflict carries a comma-separated list
   * of COLUMN NAMES. It cannot carry an expression and cannot carry a partial
   * index's WHERE clause, so a target naming `(metadata->>'thread_id')` fails on
   * every call with "there is no unique or exclusion constraint matching the ON
   * CONFLICT specification" — and fails invisibly, because this writer logs and
   * returns.
   *
   * Asserted as the property PostgREST imposes, not as equality with a string
   * written elsewhere in this repo: an oracle that shares its subject's
   * assumption checks nothing.
   */
  it("upserts on a conflict target PostgREST can actually carry", async () => {
    const { calls, result } = run(CONTACT);
    await result;
    const target = calls.find((c) => c.upserted)!.upserted!.onConflict;

    expect(target).toBe(THREAD_CONFLICT_TARGET);
    const columns = target.split(",");
    expect(columns.length).toBeGreaterThan(1);
    for (const column of columns) {
      // A plain identifier. `(metadata->>'x')` or `lower(email)` fails here,
      // which is exactly what PostgREST does with it.
      expect(column).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });

  // The lookup's column has to be the maintained one. Filtering the raw `email`
  // against a lowercased address misses every contact stored capitalised, and a
  // miss reads exactly like "they are not in the CRM" — no error, no row, no way
  // to tell from the outside.
  it("resolves the contact on email_lower, scoped to the organisation", async () => {
    const { calls, result } = run(CONTACT);
    await result;

    const lookups = calls.filter((c) => c.table === "network_contacts");
    expect(lookups).toHaveLength(1);
    expect(lookups[0].filters).toContainEqual(["organization_id", "org-1"]);
    expect(lookups[0].filters).toContainEqual(["email_lower", "ana@acme.com"]);
    expect(lookups[0].filters.some(([col]) => col === "email")).toBe(false);
  });

  it("writes nothing when the counterparty is not in the CRM", async () => {
    const { calls, result } = run({});
    expect(await result).toEqual({ written: 0, failed: false });
    expect(calls.some((c) => c.upserted)).toBe(false);
  });

  // Most of an inbox has no address to match on at all — Slack messages, calendar
  // notifications. Those must not cost a query each on the ingest path.
  it("does not query at all when there is nothing to match on", async () => {
    for (const over of [
      { orgId: null },
      { thread: { ...THREAD, counterpartyEmail: null } },
      { thread: { ...THREAD, counterpartyEmail: "   " } },
      { thread: { ...THREAD, counterpartyEmail: "not-an-address" } },
    ]) {
      const { calls, result } = run(CONTACT, {}, over);
      expect(await result).toEqual({ written: 0, failed: false });
      expect(calls).toHaveLength(0);
    }
  });

  /**
   * Every way this can go wrong, and none of them may throw.
   *
   * recordThreadOnTimeline is awaited inside ingestInboundEvent's try block: a
   * throw here is caught there and finalizes the ingest as a recorded MISS, so
   * the provider retries a delivery that already reached the inbox. A CRM
   * timeline entry is not worth that.
   */
  it("never throws, whatever the database does", async () => {
    const cases: Array<[string, Parameters<typeof fakeClient>[1]]> = [
      ["the contact lookup errors", { failOn: "network_contacts" }],
      ["the write errors", { failOn: "network_activities" }],
      ["the lookup throws", { throwOn: "network_contacts" }],
      ["the write throws", { throwOn: "network_activities" }],
    ];
    for (const [, opts] of cases) {
      const { result } = run(CONTACT, opts);
      await expect(result).resolves.toEqual(
        expect.objectContaining({ written: 0 }),
      );
    }
  });

  it("reports a failed write as failed rather than as nobody matching", async () => {
    const { result } = run(CONTACT, { failOn: "network_activities" });
    expect(await result).toEqual({ written: 0, failed: true });
  });
});

/**
 * The half of the idempotency guarantee the conflict target cannot prove.
 *
 * A well-shaped target is still rejected by Postgres unless a unique index over
 * exactly those columns exists. Read out of the migration directory, so deleting
 * or narrowing the index fails here rather than in production.
 */
describe("the schema the writer depends on", () => {
  const migrations = join(__dirname, "..", "..", "supabase", "migrations");

  function allSql(): string {
    return readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(migrations, f), "utf8"))
      .join("\n");
  }

  it("creates a unique index over exactly the columns the upsert conflicts on", () => {
    const columns = THREAD_CONFLICT_TARGET.split(",");
    const pattern = new RegExp(
      String.raw`create\s+unique\s+index[^;]*?on\s+public\.network_activities\s*\(\s*` +
        columns.map((c) => `${c}\\s*`).join(String.raw`,\s*`) +
        String.raw`\)`,
      "is",
    );
    expect(allSql()).toMatch(pattern);
  });

  // thread_id is generated from the metadata the writer sets. If that generation
  // goes, the key is NULL on every row, NULLs are distinct, and the upsert
  // silently stops de-duplicating — forty replies become forty entries.
  it("has a thread_id column generated from the metadata the writer sets", () => {
    expect(allSql()).toMatch(
      /add column if not exists thread_id text\s+generated always as \(metadata ->> 'thread_id'\) stored/i,
    );
  });

  /**
   * activity_type has a CHECK constraint. The pure tests assert against a copy of
   * that list; this asserts against the list in the migration itself, so a value
   * the database would reject cannot reach the payload.
   */
  it("only ever writes an activity_type the column's CHECK constraint accepts", async () => {
    const check = /check \(activity_type in \(([^)]*)\)\)/i.exec(allSql());
    expect(check).not.toBeNull();
    const accepted = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(accepted.length).toBeGreaterThan(5);

    for (const channel of ["gmail", "slack", "calendly", "zoom", "docusign", "a_new_provider"]) {
      const { calls, result } = run(CONTACT, {}, { thread: { ...THREAD, channel } });
      await result;
      const row = calls.find((c) => c.upserted)!.upserted!.rows[0];
      expect(accepted).toContain(row.activity_type);
    }
  });
});
