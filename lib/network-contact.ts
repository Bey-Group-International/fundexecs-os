// lib/network-contact.ts
//
// The contact record — one person, everything known about them.
//
// This is the surface Network OS did not have. The roster could rank a
// relationship and the feed could show that something happened, but there was
// nowhere to open a person and see their history, and nowhere to write to it.
// Everything on the record view is loaded here in one fan-out.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isContactStage, type ContactStage } from "@/lib/network-stages";

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "meeting",
  "email",
  "linkedin",
  "intro",
  "stage_change",
  "owner_change",
  "task",
  "commitment",
  "document",
  "import",
  "merge",
  "other",
] as const;

export type NetworkActivityKind = (typeof ACTIVITY_TYPES)[number];

/** The subset a person can log by hand. The rest are written by the system and
 *  are not user-editable — which is what makes the timeline evidence. */
export const LOGGABLE_TYPES: readonly NetworkActivityKind[] = [
  "note",
  "call",
  "meeting",
  "email",
  "linkedin",
  "intro",
  "document",
  "other",
];

export function isLoggableType(v: unknown): v is NetworkActivityKind {
  return typeof v === "string" && (LOGGABLE_TYPES as readonly string[]).includes(v);
}

export interface ContactRecord {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  location: string | null;
  capitalRole: string | null;
  relationshipType: string | null;
  stage: ContactStage;
  visibility: "org" | "private";
  ownerId: string | null;
  ownerName: string | null;
  strengthScore: number;
  strengthLabel: string;
  relevanceScore: number;
  tags: string[];
  /** Values for the org's own columns. Returned so a custom-field edit can be
   *  reflected without a second fetch — the PATCH routes write these. */
  custom: Record<string, unknown>;
  notes: string | null;
  source: string | null;
  connectedOn: string | null;
  addedAt: string | null;
  lastActivityAt: string | null;
  nextStepAt: string | null;
  verified: boolean;
  confidence: number;
  // Compliance, from 20260706160000. An operator about to send something needs
  // to see this on the record, not discover it when the send is refused.
  communicationStatus: string;
  consentBasis: string | null;
  consentAt: string | null;
  complianceFlags: string[];
  archivedAt: string | null;
  mergedIntoId: string | null;
}

export interface TimelineEntry {
  id: string;
  type: NetworkActivityKind;
  direction: "inbound" | "outbound" | "internal" | null;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  isSystem: boolean;
  metadata: Record<string, unknown>;
}

export interface ContactTask {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  priority: "low" | "normal" | "high";
  status: "open" | "done" | "cancelled";
  assigneeId: string | null;
  assigneeName: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ContactRecordView {
  contact: ContactRecord;
  timeline: TimelineEntry[];
  tasks: ContactTask[];
  /** Other contacts that look like the same person. */
  possibleDuplicates: { id: string; fullName: string; company: string | null; email: string | null }[];
}

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function mapContactRecord(row: Row, ownerName: string | null): ContactRecord {
  return {
    id: String(row.id),
    fullName: str(row.full_name) ?? "Unknown contact",
    firstName: str(row.first_name) ?? "",
    lastName: str(row.last_name) ?? "",
    title: str(row.title),
    company: str(row.company),
    companyDomain: str(row.company_domain),
    email: str(row.email),
    phone: str(row.phone),
    linkedinUrl: str(row.linkedin_url),
    avatarUrl: str(row.avatar_url),
    location: str(row.location),
    capitalRole: str(row.capital_role),
    relationshipType: str(row.relationship_type),
    stage: isContactStage(row.stage) ? row.stage : "prospect",
    visibility: row.visibility === "private" ? "private" : "org",
    ownerId: str(row.relationship_owner),
    ownerName,
    custom:
      row.custom && typeof row.custom === "object" && !Array.isArray(row.custom)
        ? (row.custom as Record<string, unknown>)
        : {},
    strengthScore: num(row.strength_score),
    strengthLabel: str(row.strength_label) ?? "cold",
    relevanceScore: num(row.relevance_score),
    tags: strArray(row.tags),
    notes: str(row.notes),
    source: str(row.source),
    connectedOn: str(row.connected_on),
    addedAt: str(row.created_at),
    lastActivityAt: str(row.last_activity_at),
    nextStepAt: str(row.next_step_at),
    verified: row.verified === true,
    confidence: num(row.confidence),
    communicationStatus: str(row.communication_status) ?? "allowed",
    consentBasis: str(row.consent_basis),
    consentAt: str(row.consent_at),
    complianceFlags: strArray(row.compliance_flags),
    archivedAt: str(row.archived_at),
    mergedIntoId: str(row.merged_into_id),
  };
}

const CONTACT_SELECT = `
  id, first_name, last_name, full_name, title, company, company_domain, email, phone,
  linkedin_url, avatar_url, location, capital_role, relationship_type, stage, visibility,
  relationship_owner, strength_score, strength_label, relevance_score, tags, notes, source,
  connected_on, created_at, last_activity_at, next_step_at, verified, confidence,
  communication_status, consent_basis, consent_at, compliance_flags, archived_at, merged_into_id,
  custom
`;

/** One display name per principal in the org, for actors, owners, assignees. */
export async function loadPrincipalNames(
  client: SupabaseClient,
  orgId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await client
      .from("organization_members")
      .select("principal_id, principals(full_name)")
      .eq("organization_id", orgId)
      .limit(200);
    for (const row of (data ?? []) as unknown as {
      principal_id: string;
      principals: { full_name: string | null } | { full_name: string | null }[] | null;
    }[]) {
      const p = Array.isArray(row.principals) ? row.principals[0] : row.principals;
      if (p?.full_name) map.set(row.principal_id, p.full_name);
    }
  } catch {
    /* names are cosmetic */
  }
  return map;
}

/**
 * Load everything the record view shows, in one fan-out.
 *
 * Returns null when the contact does not exist OR the caller cannot see it —
 * RLS makes those indistinguishable from here, which is the correct behaviour:
 * a private relationship should 404 rather than announce that it exists.
 */
export async function loadContactRecord(
  client: SupabaseClient,
  orgId: string,
  contactId: string,
  options: { timelineLimit?: number } = {},
): Promise<ContactRecordView | null> {
  const timelineLimit = options.timelineLimit ?? 100;

  const { data: contactRow, error } = await client
    .from("network_contacts")
    .select(CONTACT_SELECT)
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();

  if (error || !contactRow) return null;

  const row = contactRow as Row;

  const [names, timelineRes, tasksRes, dupes] = await Promise.all([
    loadPrincipalNames(client, orgId),
    client
      .from("network_activities")
      .select("id, activity_type, direction, subject, body, occurred_at, actor_id, is_system, metadata")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .order("occurred_at", { ascending: false })
      .limit(timelineLimit),
    client
      .from("network_tasks")
      .select("id, title, notes, due_at, priority, status, assignee_id, completed_at, created_at")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    findPossibleDuplicates(client, orgId, {
      id: String(row.id),
      fullName: str(row.full_name),
      email: str(row.email),
      company: str(row.company),
    }),
  ]);

  const contact = mapContactRecord(row, names.get(String(row.relationship_owner)) ?? null);

  const timeline: TimelineEntry[] = ((timelineRes.data ?? []) as Row[]).map((a) => ({
    id: String(a.id),
    type: (ACTIVITY_TYPES as readonly string[]).includes(String(a.activity_type))
      ? (a.activity_type as NetworkActivityKind)
      : "other",
    direction:
      a.direction === "inbound" || a.direction === "outbound" || a.direction === "internal"
        ? a.direction
        : null,
    subject: str(a.subject),
    body: str(a.body),
    occurredAt: String(a.occurred_at),
    actorId: str(a.actor_id),
    actorName: a.actor_id ? (names.get(String(a.actor_id)) ?? null) : null,
    isSystem: a.is_system === true,
    metadata: (a.metadata as Record<string, unknown>) ?? {},
  }));

  const tasks: ContactTask[] = ((tasksRes.data ?? []) as Row[]).map((t) => ({
    id: String(t.id),
    title: str(t.title) ?? "Untitled",
    notes: str(t.notes),
    dueAt: str(t.due_at),
    priority: t.priority === "high" || t.priority === "low" ? t.priority : "normal",
    status: t.status === "done" || t.status === "cancelled" ? t.status : "open",
    assigneeId: str(t.assignee_id),
    assigneeName: t.assignee_id ? (names.get(String(t.assignee_id)) ?? null) : null,
    completedAt: str(t.completed_at),
    createdAt: String(t.created_at),
  }));

  return { contact, timeline, tasks, possibleDuplicates: dupes };
}

/**
 * Find rows that look like the same person.
 *
 * An exact email match is the strong signal and is reported on its own. Failing
 * that, the same name at the same company is the usual shape of a duplicate
 * created by two people adding the same contact from different sources.
 */
export async function findPossibleDuplicates(
  client: SupabaseClient,
  orgId: string,
  subject: { id: string; fullName: string | null; email: string | null; company: string | null },
  limit = 5,
): Promise<{ id: string; fullName: string; company: string | null; email: string | null }[]> {
  const found = new Map<string, { id: string; fullName: string; company: string | null; email: string | null }>();

  const collect = (rows: Row[] | null) => {
    for (const r of rows ?? []) {
      const id = String(r.id);
      if (id === subject.id || found.has(id)) continue;
      found.set(id, {
        id,
        fullName: str(r.full_name) ?? "Unknown contact",
        company: str(r.company),
        email: str(r.email),
      });
    }
  };

  const base = () =>
    client
      .from("network_contacts")
      .select("id, full_name, company, email")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .is("merged_into_id", null)
      .neq("id", subject.id);

  try {
    if (subject.email) {
      const { data } = await base().ilike("email", subject.email).limit(limit);
      collect(data as Row[] | null);
    }
    if (found.size < limit && subject.fullName) {
      // Exact-name match only. Fuzzy matching belongs behind an explicit
      // "find duplicates" action, not on every record load.
      const { data } = await base()
        .ilike("full_name", subject.fullName)
        .limit(limit - found.size);
      collect(data as Row[] | null);
    }
  } catch {
    return [...found.values()];
  }

  return [...found.values()].slice(0, limit);
}
