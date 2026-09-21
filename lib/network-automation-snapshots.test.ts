// The two places that build a rule's snapshot have to agree.
//
// A condition is written once, against a field name, and stored as data. It is
// then evaluated in two places: on the event path, against the object
// lib/network-automation-snapshots.ts builds from the row a route just wrote;
// and on the scheduled path, against the jsonb that
// network_automation_candidates() builds in SQL.
//
// If those two ever disagree about a key, the failure is silent and nasty: a
// rule an admin wrote and watched fire on the pipeline board simply stops
// matching when the sweep evaluates it, with no error anywhere. `owner_id` is
// the obvious candidate — the contacts table calls that column
// `relationship_owner`, and both sides have to rename it the same way.
//
// So this reads the migration and compares the key sets. Nothing else enforces
// it; a comment saying "change one and change the other" is not enforcement.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  contactSnapshot,
  opportunitySnapshot,
  taskSnapshot,
} from "@/lib/network-automation-snapshots";

const MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260921120000_network_automations.sql",
);

/**
 * The keys of each `jsonb_build_object` in network_automation_candidates().
 *
 * The function is three `union all` branches — two opportunity shapes and one
 * contact shape — and each key sits at the start of its own line, which is how
 * the migration is written. A reformat that puts two arguments on one line
 * would make this parse wrong, and it would fail loudly rather than quietly
 * passing: an empty or short key list cannot match the builders below.
 */
function sqlSnapshotKeys(): string[][] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("create or replace function public.network_automation_candidates");
  expect(start).toBeGreaterThan(-1);
  const body = sql.slice(start);

  return body
    .split(/\bunion all\b/)
    .map((branch) => {
      const open = branch.indexOf("jsonb_build_object(");
      if (open === -1) return [];
      return [...branch.slice(open).matchAll(/^\s*'([a-z_]+)',/gm)].map((m) => m[1]);
    })
    .filter((keys) => keys.length > 0);
}

describe("snapshot keys agree between TypeScript and SQL", () => {
  const branches = sqlSnapshotKeys();

  it("finds all three branches, so a silent parse failure cannot pass this file", () => {
    expect(branches).toHaveLength(3);
    for (const keys of branches) expect(keys.length).toBeGreaterThan(5);
  });

  it("builds the same opportunity shape on both paths", () => {
    // Branches 1 and 2 are opportunity_idle and close_date_approaching. They
    // are separate SQL branches and could drift from each other, so both are
    // checked rather than assuming they match.
    const fromTs = Object.keys(opportunitySnapshot({})).sort();
    expect([...branches[0]].sort()).toEqual(fromTs);
    expect([...branches[1]].sort()).toEqual(fromTs);
  });

  it("builds the same contact shape on both paths", () => {
    expect([...branches[2]].sort()).toEqual(Object.keys(contactSnapshot({})).sort());
  });

  it("renames each table's owner column to the one name a rule is written against", () => {
    // The specific drift worth naming: network_contacts stores this as
    // relationship_owner and network_opportunities as owner_id. A rule says
    // "the owner" about either, so both sides normalise to owner_id — and a
    // condition on owner_id has to keep working on a contact.
    expect(contactSnapshot({ relationship_owner: "user-a" }).owner_id).toBe("user-a");
    expect(opportunitySnapshot({ owner_id: "user-a" }).owner_id).toBe("user-a");
    for (const keys of branches) expect(keys).toContain("owner_id");
    expect(branches[2]).not.toContain("relationship_owner");
  });

  it("presents an empty row as absent values rather than as missing keys", () => {
    // `is_empty` has to be answerable. A key that is missing entirely reads
    // the same as one holding null here, but tags and custom are read with
    // Array.isArray and a property lookup, so they have to be the right shape.
    const deal = opportunitySnapshot({});
    expect(deal.tags).toEqual([]);
    expect(deal.custom).toEqual({});
    const contact = contactSnapshot({});
    expect(contact.tags).toEqual([]);
    expect(contact.custom).toEqual({});
  });

  it("gives a task the keys a condition might read, even though it has none of its own", () => {
    // Tasks have no SQL counterpart — there is no scheduled task trigger — so
    // this side stands alone. tags and custom are present and empty so a
    // condition on them reads as "not set" instead of comparing to undefined.
    const task = taskSnapshot({ title: "Chase", assignee_id: "user-a" });
    expect(task.name).toBe("Chase");
    expect(task.owner_id).toBe("user-a");
    expect(task.tags).toEqual([]);
    expect(task.custom).toEqual({});
  });
});
