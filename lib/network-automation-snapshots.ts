// Turning a database row into the flat snapshot a rule is evaluated against.
//
// Kept here, apart from both halves of the engine, for one reason: the event
// path builds a snapshot from the row a route just wrote, and the scheduled
// path gets one from network_automation_candidates() in SQL. Those two have to
// agree on field names, or a condition an admin writes on the pipeline board
// silently stops matching when the same rule is evaluated by the sweep.
//
// The names here are the column names, not the API's camelCase ones. A rule is
// written against the workspace's own vocabulary and stored as data; matching
// the database is what lets the SQL candidate query produce the same shape
// without a translation layer that could drift.

import type { Snapshot } from "@/lib/network-automations";

/** A deal row → the shape a condition reads. Mirrors the jsonb_build_object in
 *  network_automation_candidates(); change one and change the other. */
export function opportunitySnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    status: row.status,
    owner_id: row.owner_id ?? null,
    contact_id: row.contact_id ?? null,
    investor_id: row.investor_id ?? null,
    fund_id: row.fund_id ?? null,
    target_amount: row.target_amount ?? null,
    currency: row.currency ?? "USD",
    probability: row.probability ?? 0,
    expected_close: row.expected_close ?? null,
    source: row.source ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom: (row.custom as Record<string, unknown>) ?? {},
    updated_at: row.updated_at ?? null,
  };
}

/** A contact row → the same. `owner_id` rather than `relationship_owner`: a
 *  rule says "the owner" about either object, and the writer of the rule
 *  should not have to know that the two tables named the column differently. */
export function contactSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id,
    name: row.full_name ?? null,
    stage: row.stage,
    company: row.company ?? null,
    title: row.title ?? null,
    owner_id: row.relationship_owner ?? null,
    contact_id: row.id,
    visibility: row.visibility ?? "org",
    strength_score: row.strength_score ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom: (row.custom as Record<string, unknown>) ?? {},
    last_activity_at: row.last_activity_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** A task row → the same. A task has no custom columns and no tags; the keys
 *  are present and empty rather than absent so a condition on them reads as
 *  "not set" instead of matching against undefined. */
export function taskSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id,
    name: row.title ?? null,
    status: row.status,
    owner_id: row.assignee_id ?? null,
    contact_id: row.contact_id ?? null,
    investor_id: row.investor_id ?? null,
    opportunity_id: row.opportunity_id ?? null,
    priority: row.priority ?? "normal",
    tags: [],
    custom: {},
    updated_at: row.updated_at ?? null,
  };
}
