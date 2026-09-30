// lib/crm/misattribution.test.ts
// The promises the correction path rests on, checked where they can be checked
// without a database.
//
// Three of them, and the first is the one the whole design turns on: a
// correction has to SURVIVE the next message. The writers upsert on
// (organization_id, contact_id, thread_id) and (…, meeting_id), so the row a
// correction marks is the same row the next reply conflicts with. PostgREST's
// ON CONFLICT DO UPDATE sets only the columns in the payload — so the mark
// survives precisely BECAUSE neither writer mentions it. Somebody adding
// `misattributed_at: null` to a payload "for completeness" would silently undo
// every correction in the org, on the next message, with no error anywhere.
import { readFileSync } from "fs";
import { join } from "path";

import { recordThreadOnTimeline } from "@/lib/inbox/crm-activity.server";
import { loadContactRecord } from "@/lib/network-contact";
import { statusForPgCode } from "@/lib/pg-error-status";

const MIGRATION = join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "20260930100000_network_activities_misattribution.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8");
}

/** Records what the writer upserts, so the payload's KEYS can be inspected. */
function capturingClient(contactId: string | null) {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: contactId ? { id: contactId } : null, error: null }),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          upserts.push(...rows);
          return { error: null };
        },
      };
      return builder;
    },
  };
  return { client, upserts };
}

describe("a correction survives the next message", () => {
  it("the inbox writer never mentions the correction columns in its payload", async () => {
    const { client, upserts } = capturingClient("contact-ana");
    await recordThreadOnTimeline(client as never, {
      orgId: "org-1",
      actorId: null,
      now: "2026-09-30T08:00:00.000Z",
      thread: {
        id: "thr-1",
        channel: "gmail",
        subject: "Q3 pacing",
        counterpartyEmail: "ana@acme.com",
        aiSummary: "Ana asked for the pacing model.",
        preview: null,
        lastMessageAt: "2026-09-23T14:00:00.000Z",
      },
    });

    expect(upserts).toHaveLength(1);
    const keys = Object.keys(upserts[0]);
    // Named individually rather than as a regex, because the failure this guards
    // against is somebody ADDING one of these deliberately.
    expect(keys).not.toContain("misattributed_at");
    expect(keys).not.toContain("misattributed_by");
    expect(keys).not.toContain("misattribution_reason");
    // And the row it conflicts with is identified by columns it DOES set, or the
    // upsert would insert a second, unmarked row instead of updating the marked
    // one.
    expect(keys).toContain("organization_id");
    expect(keys).toContain("contact_id");
    expect(upserts[0].metadata).toMatchObject({ thread_id: "thr-1" });
  });
});

/**
 * The route maps the function's error codes to statuses. Asserted against the
 * codes the MIGRATION raises, not against a list copied into this test — so a
 * new `raise exception` with an unmapped code fails here instead of reaching a
 * caller as an unexplained 500.
 */
describe("every failure the function raises has a status", () => {
  it("maps each errcode in the migration to something other than 500", () => {
    const codes = [...migrationSql().matchAll(/errcode\s*=\s*'([0-9A-Z]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(3);
    for (const code of new Set(codes)) {
      expect(statusForPgCode(code)).not.toBe(500);
    }
  });

  // And the default stays 500: an unrecognised code is a fault nobody planned
  // for, and calling it a client error would tell the caller to fix something
  // that is not theirs.
  it("still reports an unknown code as a server fault", () => {
    for (const code of [undefined, null, "", "23505", "XX000"]) {
      expect(statusForPgCode(code)).toBe(500);
    }
  });
});

/**
 * What the migration must say for the route's authorization to mean anything.
 *
 * The function is SECURITY DEFINER, which means RLS is bypassed inside it and
 * every check the policies would have made has to be made explicitly. Read out
 * of the SQL, so deleting one of those checks fails here.
 */
describe("the authorization the definer function does itself", () => {
  it("runs as definer with a fixed search_path", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/create or replace function public\.flag_network_activity_misattributed/i);

    // Matched as the CLAUSE, in the header between `language` and the body, not
    // as the phrase anywhere in the file. The first version of this asserted
    // /security definer/i against the whole migration and passed while the real
    // clause was gone, because the migration's own comment explains why it is
    // SECURITY DEFINER. An injection removing the clause broke nothing.
    expect(sql).toMatch(
      /language plpgsql\s+security definer\s+set search_path = public\s+as \$\$/i,
    );
  });

  it("requires the org-admin right and the contact's visibility", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/public\.is_org_admin\(row_org\)/);
    // The same helper the SELECT policy uses, so this cannot reach a private
    // contact the caller could not otherwise see.
    expect(sql).toMatch(/public\.network_contact_visible\(row_contact\)/);
  });

  it("refuses a hand-written entry", () => {
    // Those have an owner and ordinary edit rights; routing them through an
    // admin-only definer function would be a different power.
    expect(migrationSql()).toMatch(/if not row_system then/);
  });

  it("is not executable by anonymous callers", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/revoke all on function public\.flag_network_activity_misattributed[^;]*from public/i);
    expect(sql).toMatch(/grant execute on function public\.flag_network_activity_misattributed[^;]*to authenticated/i);
  });

  // Hiding the entry without this leaves the contact looking as recently active
  // as the wrong entry made them, which is the half of the harm a label cannot
  // reach.
  it("recomputes recency from the entries that remain", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/set last_activity_at = sub\.newest/);
    expect(sql).toMatch(/max\(a\.occurred_at\)[\s\S]*?a\.misattributed_at is null/);
  });
});

/**
 * That the readers actually skip the marked rows.
 *
 * Marking without hiding would be the worst of both: an admin told the entry was
 * corrected, and the entry still on the record. Asserted through the real loader
 * with a client that records its filters, because "the query has the predicate"
 * is a claim about a where clause and nothing else can see it.
 */
describe("the readers skip corrected entries", () => {
  /** Records every .eq()/.is() per table so a dropped predicate is visible. */
  function filterRecordingClient() {
    const filters: Record<string, Array<[string, unknown]>> = {};
    const client = {
      from(table: string) {
        filters[table] ??= [];
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[table].push([column, value]);
            return builder;
          },
          is: (column: string, value: unknown) => {
            filters[table].push([column, value]);
            return builder;
          },
          in: () => builder,
          or: () => builder,
          neq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () =>
            table === "network_contacts"
              ? { data: { id: "contact-ana", full_name: "Ana Diaz", tags: [] }, error: null }
              : { data: null, error: null },
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    };
    return { client, filters };
  }

  it("the contact record's timeline query filters on misattributed_at", async () => {
    const { client, filters } = filterRecordingClient();
    await loadContactRecord(client as never, "org-1", "contact-ana");

    expect(filters.network_activities).toContainEqual(["misattributed_at", null]);
    // Still scoped, so the filter was added rather than substituted.
    expect(filters.network_activities).toContainEqual(["organization_id", "org-1"]);
    expect(filters.network_activities).toContainEqual(["contact_id", "contact-ana"]);
  });
});
