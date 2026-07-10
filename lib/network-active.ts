// lib/network-active.ts
// The Active Network layer — the institutional view of who is actually in the
// operator's orbit right now, assembled from FIRST-PARTY Source-hub data rather
// than an imported address book. No new tables: everything is composed at query
// time from the relationship engine that already exists.
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

export type { Temperature };

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
  nextAction: string | null;
  nextActionTier: string | null;
  introducer: string | null;
  introPath: string[] | null;
  thesisFitScore: number | null;
  email: string | null;
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
  | "contact";

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
  updated_at: string | null;
}

interface DirectoryRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  role: string | null;
  type: string | null;
  status: string | null;
  updated_at: string | null;
}

async function loadContactPeople(
  client: SupabaseClient,
  orgId: string,
): Promise<ActiveNetworkPerson[]> {
  try {
    const { data } = await client
      .from("network_contacts")
      .select(
        "id, full_name, title, company, email, capital_role, strength_score, strength_label, strength_updated_at, updated_at",
      )
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("strength_score", { ascending: false })
      .limit(200);
    return ((data ?? []) as ContactRow[]).map((c) => {
      const last = c.strength_updated_at ?? c.updated_at ?? null;
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
        nextAction: null,
        nextActionTier: null,
        introducer: null,
        introPath: null,
        thesisFitScore: null,
        email: c.email,
      };
    });
  } catch {
    return [];
  }
}

async function loadDirectoryPeople(
  client: SupabaseClient,
  orgId: string,
  table: "partners" | "service_providers",
  kind: "partner" | "provider",
  typeCol: string,
): Promise<ActiveNetworkPerson[]> {
  try {
    const { data } = await client
      .from(table)
      .select(`id, name, contact_name, contact_email, role, ${typeCol}, status, updated_at`)
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(100);
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
        nextAction: null,
        nextActionTier: null,
        introducer: null,
        introPath: null,
        thesisFitScore: null,
        email: r.contact_email ?? null,
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
): Promise<{ people: ActiveNetworkPerson[]; pulse: NetworkPulse }> {
  const client = loose(db);

  const entries = await buildCapitalMap(db).catch(() => []);
  const investorIds = entries.map((e) => e.investor.id);
  const summaries = investorIds.length
    ? await getLPRelationshipSummaries(client, orgId, investorIds).catch(
        () => new Map<string, { lastContactAt: string | null; lastContactDays: number | null; topActionTitle: string | null }>(),
      )
    : new Map();

  const temperature: Record<Temperature, number> = { cold: 0, warm: 0, active: 0, committed: 0 };
  let committed = 0;
  let engaged = 0;

  const investorPeople: ActiveNetworkPerson[] = entries.map((e) => {
    const inv = e.investor;
    const rel = summaries.get(inv.id);
    const top = e.nextActions[0] ?? null;
    temperature[e.temperature] += 1;
    if (e.temperature === "committed") committed += 1;
    if (e.temperature !== "cold") engaged += 1;
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
      nextAction: rel?.topActionTitle ?? top?.label ?? null,
      nextActionTier: top?.tier != null ? String(top.tier) : null,
      introducer: e.introPath?.introducer ?? null,
      introPath: e.introPath?.hops ?? null,
      thesisFitScore: e.thesisFit?.score ?? null,
      email: inv.contact_email ?? null,
    };
  });

  const [contactPeople, partnerPeople, providerPeople] = await Promise.all([
    loadContactPeople(client, orgId),
    loadDirectoryPeople(client, orgId, "partners", "partner", "partner_type"),
    loadDirectoryPeople(client, orgId, "service_providers", "provider", "provider_type"),
  ]);

  const people = [...investorPeople, ...contactPeople, ...partnerPeople, ...providerPeople].sort(
    (a, b) => b.warmth - a.warmth,
  );

  const pulse: NetworkPulse = {
    people: people.length,
    committed,
    engaged,
    temperature,
  };

  return { people, pulse };
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

/** Build an id → { firm, person } label map for the org's investors. */
async function investorLabels(
  client: SupabaseClient,
  orgId: string,
): Promise<Map<string, { firm: string; person: string | null }>> {
  const map = new Map<string, { firm: string; person: string | null }>();
  const rows = await tryQuery<{ id: string; name: string; contact_name: string | null }>(() =>
    client.from("investors").select("id, name, contact_name").eq("organization_id", orgId).limit(500),
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
  const labels = await investorLabels(client, orgId);
  const label = (id: string | null): string | null =>
    id ? labels.get(id)?.person?.trim() || labels.get(id)?.firm || null : null;
  const firm = (id: string | null): string | null => (id ? labels.get(id)?.firm ?? null : null);

  const events: NetworkActivityEvent[] = [];

  // 1. Market signals — the richest, most human-readable source.
  try {
    const signals = await listSignals(db as unknown as Parameters<typeof listSignals>[0], orgId, {
      limit: 30,
    });
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
  } catch {
    /* no signals surface */
  }

  // 2. Capital commitments — the strongest possible relationship event.
  const commitments = await tryQuery<{
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
  );
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
  const touches = await tryQuery<{
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
  );
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
  const intros = await tryQuery<{
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
  );
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
  const actions = await tryQuery<{
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
  );
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
  const meetings = await tryQuery<{
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
  );
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
  const outreach = await tryQuery<{
    id: string;
    channel: string;
    status: string;
    created_at: string;
  }>(() =>
    client
      .from("outreach_drafts")
      .select("id, channel, status, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10),
  );
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
  const prospects = await tryQuery<{ id: string; name: string; created_at: string }>(() =>
    client
      .from("investors")
      .select("id, name, created_at")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(8),
  );
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

  const contacts = await tryQuery<{ id: string; full_name: string | null; created_at: string }>(() =>
    client
      .from("network_contacts")
      .select("id, full_name, created_at")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(8),
  );
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
