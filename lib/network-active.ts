// lib/network-active.ts
// The Active Network layer — the institutional view of who is actually in the
// operator's orbit right now, assembled from FIRST-PARTY Source-hub data rather
// than an imported address book. The roster is still COMPOSED at query time
// from the relationship engine; what 20260919120000 added is the CRM spine the
// composed view had nowhere to write to — stage, owner, visibility, and a
// logged timeline, all of which flow through here alongside the composed rows.
//
//   • Roster  — real people/firms ranked by warmth. Investors come through
//     buildCapitalMap (temperature + thesis-fit + intro path + next action);
//     network_contacts add relationship-capital contacts; partners and service
//     providers round out the working network.
//   • Pulse   — live counts: engaged relationships, committed capital, warm+,
//     plus a temperature breakdown for the header instrument panel.
//   • Feed    — a chronological activity stream derived from entity_signals,
//     relationship touches, next-best-actions, warm intros, meetings, outreach,
//     and freshly-added prospects/contacts.
//
// Every secondary read is wrapped so a missing surface contributes nothing
// rather than failing the page. RLS scopes all reads to the caller's org.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildCapitalMap, type Temperature } from "@/lib/capital-map";
import { getLPRelationshipSummaries } from "@/lib/lp-relationships";
import { listSignals, SIGNAL_LABELS } from "@/lib/sourcing-signals";
// The stage vocabulary lives in its own module so client components can import
// it without pulling this file's server-only dependencies into their bundle.
import { CONTACT_STAGES, isContactStage, type ContactStage } from "@/lib/network-stages";

export type { Temperature };
export { CONTACT_STAGES, isContactStage };
export type { ContactStage };

// ── People ───────────────────────────────────────────────────────────────────

export type PersonKind = "investor" | "contact" | "partner" | "provider";

export interface ActiveNetworkPerson {
  id: string;
  kind: PersonKind;
  /** Person name where we have one, else the firm. */
  name: string;
  /** Firm / company, when the name above is a person. */
  org: string | null;
  role: string | null;
  category: string | null; // investor_type / capital_role / partner_type
  temperature: Temperature | null;
  /** 0–100 ranking key (warmth for investors, strength for contacts). */
  warmth: number;
  committedAmount: number;
  lastContactAt: string | null;
  lastContactDays: number | null;
  /** When this person entered the network (connected_on / created_at). */
  addedAt: string | null;
  nextAction: string | null;
  nextActionTier: string | null;
  introducer: string | null;
  introPath: string[] | null;
  thesisFitScore: number | null;
  email: string | null;
  // ── CRM state (20260919120000). Contacts carry all of it; investors,
  // partners, and providers carry what their own tables know.
  /** Capital-formation stage — distinct from temperature, which is warmth. */
  stage: ContactStage | null;
  /** Principal who owns the relationship, when one is assigned. */
  ownerId: string | null;
  ownerName: string | null;
  /** 'org' (pooled) or 'private' (owner, creator, and admins only). */
  visibility: "org" | "private";
  /** Most recent logged timeline entry — the "gone quiet" signal. */
  lastActivityAt: string | null;
  /** Count of open follow-ups against this person. */
  openTasks: number;
  tags: string[];
}


export interface NetworkPulse {
  /** Total people across every source. */
  people: number;
  /** Investors with committed capital. */
  committed: number;
  /** Relationships that are warm, active, or committed (not cold). */
  engaged: number;
  temperature: Record<Temperature, number>;
}

// ── Activity feed ─────────────────────────────────────────────────────────────

export type ActivityType =
  | "signal"
  | "commitment"
  | "touch"
  | "intro"
  | "action"
  | "meeting"
  | "outreach"
  | "prospect"
  | "contact"
  | "note"
  | "call"
  | "email";

/** A hand-logged timeline row, with the contact name joined in. */
interface LoggedActivityRow {
  id: string;
  contact_id: string | null;
  investor_id: string | null;
  activity_type: string;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  network_contacts: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** network_activities.activity_type → the feed's own vocabulary. */
const LOGGED_TYPE: Record<string, ActivityType> = {
  note: "note",
  call: "call",
  email: "email",
  linkedin: "outreach",
  meeting: "meeting",
  intro: "intro",
  commitment: "commitment",
  stage_change: "action",
  owner_change: "action",
  task: "action",
  document: "action",
  import: "contact",
  merge: "contact",
};

/** Fallback headline when an entry was logged without a subject line. */
const LOGGED_VERB: Record<string, string> = {
  note: "Note logged",
  call: "Call logged",
  email: "Email logged",
  linkedin: "LinkedIn message logged",
  meeting: "Meeting logged",
  intro: "Introduction logged",
  commitment: "Commitment recorded",
  stage_change: "Stage changed",
  owner_change: "Owner changed",
  task: "Follow-up logged",
  document: "Document shared",
  import: "Imported",
  merge: "Records merged",
};

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface NetworkActivityEvent {
  id: string;
  type: ActivityType;
  title: string;
  detail: string | null;
  /** The person/firm the event concerns, when identifiable. */
  actor: string | null;
  temperature: Temperature | null;
  /** Optional 0–100 intensity (signal strength) for accenting. */
  strength: number | null;
  amount: number | null;
  at: string; // ISO 8601
}

export interface NetworkLiveCounts {
  signals7d: number;
  touches7d: number;
  newThisWeek: number;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// The engine's typed client vs. the loose client the newer relationship tables
// (not in database.types) need. Cast once, here.
function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

/** Map network_contacts strength labels onto the shared temperature scale.
 *  "committed" stays reserved for real capital commitments, so a strong
 *  relationship reads as "active" rather than overstating a close. */
function strengthToTemperature(label: string | null): Temperature {
  switch (label) {
    case "strong":
    case "active":
      return "active";
    case "warm":
      return "warm";
    default:
      return "cold";
  }
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

/** Investors have no `stage` column — their capital-map temperature is the
 *  stage. Mapping it onto the shared vocabulary lets one roster filter cover
 *  investors and contacts alike. */
const TEMPERATURE_TO_STAGE: Record<Temperature, ContactStage> = {
  committed: "committed",
  active: "diligence",
  warm: "engaged",
  cold: "prospect",
};

/** Compact USD, institutional style: $1.2B / $850M / $500K. */
export function formatCompactUsd(n: number): string {
  if (!n) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// ── Roster + pulse ────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  capital_role: string | null;
  strength_score: number | null;
  strength_label: string | null;
  strength_updated_at: string | null;
  connected_on: string | null;
  created_at: string | null;
  updated_at: string | null;
  stage: string | null;
  visibility: string | null;
  relationship_owner: string | null;
  last_activity_at: string | null;
  next_step_at: string | null;
  tags: string[] | null;
}

interface DirectoryRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  role: string | null;
  type: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const CONTACT_COLUMNS_LEGACY =
  "id, full_name, title, company, email, capital_role, strength_score, strength_label, strength_updated_at, connected_on, created_at, updated_at";

const CONTACT_COLUMNS =
  `${CONTACT_COLUMNS_LEGACY}, stage, visibility, relationship_owner, last_activity_at, next_step_at, tags`;

function mapContact(c: ContactRow): ActiveNetworkPerson {
  // "Last contact" now prefers a real logged timeline entry and only falls back
  // to the scoring timestamp, which moves whenever the engine re-scores and so
  // overstates how recently a human actually spoke to this person.
  const last = c.last_activity_at ?? c.strength_updated_at ?? c.updated_at ?? null;
  return {
    id: c.id,
    kind: "contact" as const,
    name: c.full_name ?? "Unknown contact",
    org: c.company,
    role: c.title,
    category: c.capital_role && c.capital_role !== "unknown" ? c.capital_role : null,
    temperature: strengthToTemperature(c.strength_label),
    warmth: c.strength_score ?? 0,
    committedAmount: 0,
    lastContactAt: last,
    lastContactDays: last ? Math.floor((Date.now() - Date.parse(last)) / DAY_MS) : null,
    addedAt: c.connected_on ?? c.created_at ?? null,
    nextAction: null,
    nextActionTier: null,
    introducer: null,
    introPath: null,
    thesisFitScore: null,
    email: c.email,
    stage: isContactStage(c.stage) ? c.stage : "prospect",
    ownerId: c.relationship_owner ?? null,
    ownerName: null,
    visibility: c.visibility === "private" ? "private" : "org",
    lastActivityAt: c.last_activity_at ?? null,
    openTasks: 0,
    tags: c.tags ?? [],
  };
}

async function loadContactPeople(
  client: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<ActiveNetworkPerson[]> {
  const query = (columns: string, crmColumnsPresent: boolean) => {
    let q = client
      .from("network_contacts")
      .select(columns)
      .eq("organization_id", orgId)
      .is("archived_at", null);
    // A merged-away duplicate is kept for its foreign keys and audit trail but
    // must never appear in the roster.
    if (crmColumnsPresent) q = q.is("merged_into_id", null);
    return q.order("strength_score", { ascending: false }).limit(limit);
  };

  try {
    const { data, error } = await query(CONTACT_COLUMNS, true);
    if (error) throw error;
    return ((data ?? []) as unknown as ContactRow[]).map(mapContact);
  } catch {
    // The CRM spine migration has not been applied yet. Fall back to the
    // columns that have always existed rather than emptying the roster —
    // a missing column must cost the new fields, not the whole network.
    try {
      const { data } = await query(CONTACT_COLUMNS_LEGACY, false);
      return ((data ?? []) as unknown as ContactRow[]).map(mapContact);
    } catch {
      return [];
    }
  }
}

async function loadDirectoryPeople(
  client: SupabaseClient,
  orgId: string,
  table: "partners" | "service_providers",
  kind: "partner" | "provider",
  typeCol: string,
  limit = 100,
): Promise<ActiveNetworkPerson[]> {
  try {
    const { data } = await client
      .from(table)
      .select(`id, name, contact_name, contact_email, role, ${typeCol}, status, created_at, updated_at`)
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((raw) => {
      const r = raw as unknown as DirectoryRow & Record<string, unknown>;
      const type = (raw[typeCol] as string | null) ?? null;
      const status = (r.status as string | null) ?? null;
      const person = r.contact_name?.trim();
      const last = r.updated_at ?? null;
      // Recency-weighted warmth so a working relationship outranks a dormant one.
      const days = last ? Math.floor((Date.now() - Date.parse(last)) / DAY_MS) : 999;
      const recency = days <= 14 ? 25 : days <= 45 ? 15 : days <= 120 ? 8 : 2;
      const base = status === "active" ? 20 : 8;
      return {
        id: r.id,
        kind,
        name: person || r.name,
        org: person ? r.name : null,
        role: r.role ?? null,
        category: type,
        temperature: (status === "active" ? "warm" : "cold") as Temperature,
        warmth: Math.min(60, base + recency),
        committedAmount: 0,
        lastContactAt: last,
        lastContactDays: last ? days : null,
        addedAt: (r.created_at as string | null) ?? null,
        nextAction: null,
        nextActionTier: null,
        introducer: null,
        introPath: null,
        thesisFitScore: null,
        email: r.contact_email ?? null,
        // Partners and providers live in their own tables and have no CRM
        // spine of their own; their stage is implied by their status.
        stage: status === "active" ? ("engaged" as ContactStage) : ("dormant" as ContactStage),
        ownerId: null,
        ownerName: null,
        visibility: "org" as const,
        lastActivityAt: last,
        openTasks: 0,
        tags: [],
      };
    });
  } catch {
    return [];
  }
}

/**
 * Assemble the active-network roster (ranked hottest-first) and the header
 * pulse. Investors carry the full relationship signal from the capital map;
 * contacts, partners, and providers fill in the rest of the working network.
 */
export async function loadActiveNetwork(
  db: SupabaseClient<Database>,
  orgId: string,
  options: { contactLimit?: number; directoryLimit?: number } = {},
): Promise<{ people: ActiveNetworkPerson[]; pulse: NetworkPulse }> {
  const client = loose(db);
  const contactLimit = options.contactLimit ?? 500;
  const directoryLimit = options.directoryLimit ?? 200;

  // The capital map and the three directory reads are independent, so they all
  // go out together. Only the LP relationship summaries have to wait, because
  // they need the investor ids the capital map returns.
  const [entries, contactPeople, partnerPeople, providerPeople, owners] = await Promise.all([
    buildCapitalMap(db).catch(() => [] as Awaited<ReturnType<typeof buildCapitalMap>>),
    loadContactPeople(client, orgId, contactLimit),
    loadDirectoryPeople(client, orgId, "partners", "partner", "partner_type", directoryLimit),
    loadDirectoryPeople(client, orgId, "service_providers", "provider", "provider_type", directoryLimit),
    loadOwnerNames(client, orgId),
  ]);

  const investorIds = entries.map((e) => e.investor.id);
  const summaries = investorIds.length
    ? await getLPRelationshipSummaries(client, orgId, investorIds).catch(
        () => new Map<string, { lastContactAt: string | null; lastContactDays: number | null; topActionTitle: string | null }>(),
      )
    : new Map();

  const investorPeople: ActiveNetworkPerson[] = entries.map((e) => {
    const inv = e.investor;
    const rel = summaries.get(inv.id);
    const top = e.nextActions[0] ?? null;
    const person = inv.contact_name?.trim();
    return {
      id: inv.id,
      kind: "investor" as const,
      name: person || inv.name,
      org: person ? inv.name : null,
      role: inv.role ?? null,
      category: inv.investor_type ?? null,
      temperature: e.temperature,
      warmth: e.warmth,
      committedAmount: e.committedAmount,
      lastContactAt: rel?.lastContactAt ?? null,
      lastContactDays: rel?.lastContactDays ?? null,
      addedAt: (inv as { created_at?: string | null }).created_at ?? null,
      nextAction: rel?.topActionTitle ?? top?.label ?? null,
      nextActionTier: top?.tier != null ? String(top.tier) : null,
      introducer: e.introPath?.introducer ?? null,
      introPath: e.introPath?.hops ?? null,
      thesisFitScore: e.thesisFit?.score ?? null,
      email: inv.contact_email ?? null,
      // An investor's stage is already expressed by the capital map's
      // temperature; mirror it onto the shared stage vocabulary so the roster
      // can filter investors and contacts with one control.
      stage: TEMPERATURE_TO_STAGE[e.temperature],
      ownerId: null,
      ownerName: null,
      visibility: "org" as const,
      lastActivityAt: rel?.lastContactAt ?? null,
      openTasks: 0,
      tags: [],
    };
  });

  const people = [...investorPeople, ...contactPeople, ...partnerPeople, ...providerPeople]
    .map((p) => (p.ownerId ? { ...p, ownerName: owners.get(p.ownerId) ?? null } : p))
    .sort((a, b) => b.warmth - a.warmth);

  return { people, pulse: computePulse(people) };
}

/**
 * The header instrument panel, counted over the WHOLE roster.
 *
 * This used to tally only investors while reporting `people` across every
 * source, so an org with 300 contacts and 4 investors read "304 in your orbit,
 * 2 engaged" — the two numbers were measuring different populations.
 */
export function computePulse(people: ActiveNetworkPerson[]): NetworkPulse {
  const temperature: Record<Temperature, number> = { cold: 0, warm: 0, active: 0, committed: 0 };
  let committed = 0;
  let engaged = 0;

  for (const p of people) {
    const t = p.temperature ?? "cold";
    temperature[t] += 1;
    if (t === "committed") committed += 1;
    if (t !== "cold") engaged += 1;
  }

  return { people: people.length, committed, engaged, temperature };
}

/** Principal id → display name, for rendering relationship owners. */
async function loadOwnerNames(
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
    /* owner names are cosmetic — an unavailable join must not cost the roster */
  }
  return map;
}

// ── Activity feed ─────────────────────────────────────────────────────────────

async function tryQuery<T>(fn: () => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await fn();
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Build an id → { firm, person } label map for the investors the feed actually
 * mentions.
 *
 * This used to pull every investor in the org (up to 500 rows) before any feed
 * query had run, on a route the Network page polls on an interval. Now it runs
 * after the sources return and asks only for the handful of ids they cited.
 */
async function investorLabels(
  client: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, { firm: string; person: string | null }>> {
  const map = new Map<string, { firm: string; person: string | null }>();
  if (ids.length === 0) return map;
  const rows = await tryQuery<{ id: string; name: string; contact_name: string | null }>(() =>
    client
      .from("investors")
      .select("id, name, contact_name")
      .eq("organization_id", orgId)
      .in("id", ids.slice(0, 200)),
  );
  for (const r of rows) map.set(r.id, { firm: r.name, person: r.contact_name });
  return map;
}

/**
 * Compose the chronological network activity feed from first-party engagement
 * data. Newest first. Never throws — a missing surface simply contributes no
 * events. `limit` caps the merged result.
 */
export async function loadNetworkActivity(
  db: SupabaseClient<Database>,
  orgId: string,
  limit = 40,
): Promise<NetworkActivityEvent[]> {
  const client = loose(db);

  // Every source is independent, so they all go out at once. This function
  // previously awaited nine queries one after another — including a 500-row
  // investor scan before the first source query was even issued — on a route
  // the Network page polls. The whole feed is now two round-trip waves: all
  // sources together, then one label lookup for the ids they cited.
  const [
    signals,
    commitments,
    touches,
    intros,
    actions,
    meetings,
    outreach,
    prospects,
    contacts,
    logged,
  ] = await Promise.all([
    listSignals(db as unknown as Parameters<typeof listSignals>[0], orgId, { limit: 30 }).catch(
      () => [] as Awaited<ReturnType<typeof listSignals>>,
    ),
    tryQuery<{
      id: string;
      investor_id: string;
      committed_amount: number | null;
      committed_at: string | null;
      created_at: string;
    }>(() =>
      client
        .from("commitments")
        .select("id, investor_id, committed_amount, committed_at, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(15),
    ),
    tryQuery<{
      investor_id: string;
      last_contact_at: string | null;
      temperature: Temperature;
      interaction_count: number | null;
    }>(() =>
      client
        .from("relationship_scores")
        .select("investor_id, last_contact_at, temperature, interaction_count")
        .eq("organization_id", orgId)
        .not("last_contact_at", "is", null)
        .order("last_contact_at", { ascending: false })
        .limit(20),
    ),
    tryQuery<{
      id: string;
      target_name: string;
      introducer_name: string | null;
      status: string;
      sent_at: string | null;
      created_at: string;
    }>(() =>
      client
        .from("intro_requests")
        .select("id, target_name, introducer_name, status, sent_at, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(15),
    ),
    tryQuery<{
      id: string;
      investor_id: string | null;
      title: string;
      action_type: string;
      created_at: string;
    }>(() =>
      client
        .from("next_best_actions")
        .select("id, investor_id, title, action_type, created_at")
        .eq("organization_id", orgId)
        .is("completed_at", null)
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(12),
    ),
    tryQuery<{
      id: string;
      investor_id: string | null;
      meeting_title: string;
      meeting_at: string;
      created_at: string;
    }>(() =>
      client
        .from("meeting_briefs")
        .select("id, investor_id, meeting_title, meeting_at, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(12),
    ),
    tryQuery<{ id: string; channel: string; status: string; created_at: string }>(() =>
      client
        .from("outreach_drafts")
        .select("id, channel, status, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(10),
    ),
    tryQuery<{ id: string; name: string; created_at: string }>(() =>
      client
        .from("investors")
        .select("id, name, created_at")
        .eq("organization_id", orgId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(8),
    ),
    tryQuery<{ id: string; full_name: string | null; created_at: string }>(() =>
      client
        .from("network_contacts")
        .select("id, full_name, created_at")
        .eq("organization_id", orgId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(8),
    ),
    // The CRM timeline: notes, calls, and meetings people logged by hand.
    tryQuery<LoggedActivityRow>(() =>
      client
        .from("network_activities")
        .select(
          "id, contact_id, investor_id, activity_type, subject, body, occurred_at, network_contacts(full_name)",
        )
        .eq("organization_id", orgId)
        .order("occurred_at", { ascending: false })
        .limit(20),
    ),
  ]);

  // One label lookup, scoped to the ids the sources above actually referenced.
  const referenced = new Set<string>();
  for (const c of commitments) if (c.investor_id) referenced.add(c.investor_id);
  for (const t of touches) if (t.investor_id) referenced.add(t.investor_id);
  for (const a of actions) if (a.investor_id) referenced.add(a.investor_id);
  for (const m of meetings) if (m.investor_id) referenced.add(m.investor_id);
  for (const l of logged) if (l.investor_id) referenced.add(l.investor_id);

  const labels = await investorLabels(client, orgId, [...referenced]);
  const label = (id: string | null): string | null =>
    id ? labels.get(id)?.person?.trim() || labels.get(id)?.firm || null : null;
  const firm = (id: string | null): string | null => (id ? labels.get(id)?.firm ?? null : null);

  const events: NetworkActivityEvent[] = [];

  // 1. Market signals — the richest, most human-readable source.
  for (const s of signals) {
    events.push({
      id: `signal:${s.id}`,
      type: "signal",
      title: `${SIGNAL_LABELS[s.signalType] ?? "Signal"} · ${s.subjectName}`,
      detail: s.summary,
      actor: s.subjectName,
      temperature: null,
      strength: s.strength ?? null,
      amount: null,
      at: s.occurredAt ?? s.createdAt,
    });
  }

  // 2. Capital commitments — the strongest possible relationship event.
  for (const c of commitments) {
    events.push({
      id: `commitment:${c.id}`,
      type: "commitment",
      title: `${firm(c.investor_id) ?? "An investor"} committed ${formatCompactUsd(Number(c.committed_amount ?? 0))}`,
      detail: null,
      actor: firm(c.investor_id),
      temperature: "committed",
      strength: null,
      amount: Number(c.committed_amount ?? 0),
      at: c.committed_at ?? c.created_at,
    });
  }

  // 3. Relationship touches — last-contact events with temperature.
  for (const t of touches) {
    if (!t.last_contact_at) continue;
    const who = label(t.investor_id);
    events.push({
      id: `touch:${t.investor_id}:${t.last_contact_at}`,
      type: "touch",
      title: `Touch logged with ${who ?? "an investor"}`,
      detail: t.interaction_count ? `${t.interaction_count} interactions to date` : null,
      actor: who,
      temperature: t.temperature ?? null,
      strength: null,
      amount: null,
      at: t.last_contact_at,
    });
  }

  // 4. Warm intros.
  for (const i of intros) {
    const verb = i.status === "sent" ? "sent to" : i.status === "replied" ? "replied —" : "requested to";
    events.push({
      id: `intro:${i.id}`,
      type: "intro",
      title: `Warm intro ${verb} ${i.target_name}`,
      detail: i.introducer_name ? `via ${i.introducer_name}` : null,
      actor: i.target_name,
      temperature: null,
      strength: null,
      amount: null,
      at: i.sent_at ?? i.created_at,
    });
  }

  // 5. Next-best actions surfaced by the relationship engine.
  for (const a of actions) {
    events.push({
      id: `action:${a.id}`,
      type: "action",
      title: a.title,
      detail: label(a.investor_id) ? `Recommended · ${label(a.investor_id)}` : "Recommended next move",
      actor: label(a.investor_id),
      temperature: null,
      strength: null,
      amount: null,
      at: a.created_at,
    });
  }

  // 6. Meeting briefs.
  for (const m of meetings) {
    events.push({
      id: `meeting:${m.id}`,
      type: "meeting",
      title: m.meeting_title,
      detail: label(m.investor_id) ? `Meeting · ${label(m.investor_id)}` : "Meeting brief prepared",
      actor: label(m.investor_id),
      temperature: null,
      strength: null,
      amount: null,
      at: m.created_at,
    });
  }

  // 7. Outreach drafted.
  for (const o of outreach) {
    events.push({
      id: `outreach:${o.id}`,
      type: "outreach",
      title: `Outreach ${o.status === "sent" ? "sent" : "drafted"} · ${o.channel.replace(/_/g, " ")}`,
      detail: null,
      actor: null,
      temperature: null,
      strength: null,
      amount: null,
      at: o.created_at,
    });
  }

  // 8. Freshly added prospects and contacts.
  for (const p of prospects) {
    events.push({
      id: `prospect:${p.id}`,
      type: "prospect",
      title: `${p.name} added to the capital pipeline`,
      detail: null,
      actor: p.name,
      temperature: null,
      strength: null,
      amount: null,
      at: p.created_at,
    });
  }

  for (const c of contacts) {
    events.push({
      id: `contact:${c.id}`,
      type: "contact",
      title: `${c.full_name ?? "New contact"} joined your network`,
      detail: null,
      actor: c.full_name,
      temperature: null,
      strength: null,
      amount: null,
      at: c.created_at,
    });
  }

  // 9. Hand-logged CRM timeline entries.
  for (const l of logged) {
    const joined = Array.isArray(l.network_contacts) ? l.network_contacts[0] : l.network_contacts;
    const who = joined?.full_name ?? label(l.investor_id);
    events.push({
      id: `logged:${l.id}`,
      type: LOGGED_TYPE[l.activity_type] ?? "touch",
      title: l.subject?.trim() || `${LOGGED_VERB[l.activity_type] ?? "Activity"}${who ? ` · ${who}` : ""}`,
      detail: l.body ? truncate(l.body, 160) : who,
      actor: who,
      temperature: null,
      strength: null,
      amount: null,
      at: l.occurred_at,
    });
  }

  // Merge, newest first, drop anything without a parseable timestamp.
  return events
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

// ── Live counts (cheap, poll-friendly) ────────────────────────────────────────

async function countSince(
  client: SupabaseClient,
  orgId: string,
  table: string,
  col: string,
  sinceMs: number,
): Promise<number> {
  try {
    const since = new Date(Date.now() - sinceMs).toISOString();
    const { count } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte(col, since);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Cheap count-only reads for the live header — safe to poll on an interval
 * without re-running the full capital map.
 */
export async function loadNetworkLiveCounts(
  db: SupabaseClient<Database>,
  orgId: string,
): Promise<NetworkLiveCounts> {
  const client = loose(db);
  const [signals7d, touches7d, newProspects, newContacts] = await Promise.all([
    countSince(client, orgId, "entity_signals", "created_at", WEEK_MS),
    countSince(client, orgId, "relationship_scores", "last_contact_at", WEEK_MS),
    countSince(client, orgId, "investors", "created_at", WEEK_MS),
    countSince(client, orgId, "network_contacts", "created_at", WEEK_MS),
  ]);
  return { signals7d, touches7d, newThisWeek: newProspects + newContacts };
}
