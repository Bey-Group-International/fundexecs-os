// lib/network-roster.ts
//
// Server-side roster querying for Network OS.
//
// The Network page used to hand the client the ENTIRE roster — every investor
// from the capital map plus 200 contacts plus 200 directory rows, each a fully
// populated object — and then filter, sort, and paginate it in the browser. On
// a real book that is a multi-megabyte payload the operator waits for before
// seeing the first thirty rows, and every filter change re-renders all of it.
//
// The composition itself is the expensive part (buildCapitalMap fans out across
// the relationship engine), so it is cached per-org for a short window and the
// filter/sort/page step runs against that cached array. Everything below the
// cache is pure and synchronous, which is what makes it testable without a
// database and cheap enough to run per request.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  loadActiveNetwork,
  computePulse,
  type ActiveNetworkPerson,
  type NetworkPulse,
  type PersonKind,
  type Temperature,
} from "@/lib/network-active";
import { isContactStage, type ContactStage } from "@/lib/network-stages";

const DAY_MS = 86_400_000;

/** A relationship with no logged contact in this many days needs attention. */
export const STALE_AFTER_DAYS = 30;

export const ROSTER_SORTS = ["warmth", "recent", "first", "last", "touch", "stale"] as const;
export type RosterSort = (typeof ROSTER_SORTS)[number];

export const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export interface RosterQuery {
  /** Free-text match over name, org, role, email, and tags. */
  q: string;
  temp: Temperature | "all";
  kind: PersonKind | "all";
  stage: ContactStage | "all";
  /** A principal id, "unassigned", or "all". */
  owner: string;
  category: string;
  committedOnly: boolean;
  introOnly: boolean;
  /** Only relationships that have gone quiet past STALE_AFTER_DAYS. */
  needsAttention: boolean;
  sort: RosterSort;
  offset: number;
  limit: number;
}

export const DEFAULT_ROSTER_QUERY: RosterQuery = {
  q: "",
  temp: "all",
  kind: "all",
  stage: "all",
  owner: "all",
  category: "all",
  committedOnly: false,
  introOnly: false,
  needsAttention: false,
  sort: "warmth",
  offset: 0,
  limit: DEFAULT_PAGE_SIZE,
};

/** Counts for the filter chips, computed over the result set so the numbers the
 *  operator sees match what the filters would actually return. */
export interface RosterFacets {
  temperature: Record<Temperature, number>;
  kind: Record<PersonKind, number>;
  stage: Record<ContactStage, number>;
  needsAttention: number;
  categories: { value: string; count: number }[];
}

export interface RosterPage {
  rows: ActiveNetworkPerson[];
  /** Rows matching the filters, before paging. */
  total: number;
  /** Offset to request next, or null at the end of the list. */
  nextOffset: number | null;
  facets: RosterFacets;
  /** Pulse over the whole roster, not the filtered slice. */
  pulse: NetworkPulse;
}

// ── Query parsing ────────────────────────────────────────────────────────────

const TEMPERATURES: readonly Temperature[] = ["cold", "warm", "active", "committed"];
const KINDS: readonly PersonKind[] = ["investor", "contact", "partner", "provider"];

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T | "all"): T | "all" {
  if (!raw || raw === "all") return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function boolParam(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

/** Parse untrusted query-string params into a bounded RosterQuery. Anything
 *  unrecognised falls back to the default rather than erroring — a stale
 *  bookmark should still render the roster. */
export function parseRosterQuery(params: URLSearchParams): RosterQuery {
  const rawLimit = parseInt(params.get("limit") ?? "", 10);
  const rawOffset = parseInt(params.get("offset") ?? "", 10);
  const sort = params.get("sort");
  const stage = params.get("stage");

  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    temp: oneOf(params.get("temp"), TEMPERATURES, "all"),
    kind: oneOf(params.get("kind"), KINDS, "all"),
    stage: stage && isContactStage(stage) ? stage : "all",
    owner: (params.get("owner") ?? "all").slice(0, 64),
    category: (params.get("category") ?? "all").slice(0, 64),
    committedOnly: boolParam(params.get("committed")),
    introOnly: boolParam(params.get("intro")),
    needsAttention: boolParam(params.get("attention")),
    sort: (ROSTER_SORTS as readonly string[]).includes(sort ?? "") ? (sort as RosterSort) : "warmth",
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? Math.min(rawOffset, 100_000) : 0,
    limit: Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE,
  };
}

// ── Filtering ────────────────────────────────────────────────────────────────

function haystack(p: ActiveNetworkPerson): string {
  return [p.name, p.org, p.role, p.email, p.category, ...(p.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Days since the last logged contact, or null when nothing has been logged. */
export function daysSinceContact(p: ActiveNetworkPerson, now = Date.now()): number | null {
  const iso = p.lastActivityAt ?? p.lastContactAt;
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor((now - ms) / DAY_MS);
}

/**
 * A relationship needs attention when it is worth keeping and has gone quiet.
 *
 * Cold rows are excluded on purpose: a cold contact nobody has called is not a
 * lapse, it is a cold contact. Never-contacted rows that are warm or better DO
 * count — an engaged relationship with no logged touch is exactly the gap this
 * is meant to surface.
 */
export function needsAttention(p: ActiveNetworkPerson, now = Date.now()): boolean {
  if (!p.temperature || p.temperature === "cold") return false;
  const days = daysSinceContact(p, now);
  return days === null || days >= STALE_AFTER_DAYS;
}

export function filterRoster(
  people: ActiveNetworkPerson[],
  query: RosterQuery,
  now = Date.now(),
): ActiveNetworkPerson[] {
  const needle = query.q.trim().toLowerCase();

  return people.filter((p) => {
    if (needle && !haystack(p).includes(needle)) return false;
    if (query.temp !== "all" && p.temperature !== query.temp) return false;
    if (query.kind !== "all" && p.kind !== query.kind) return false;
    if (query.stage !== "all" && p.stage !== query.stage) return false;
    if (query.category !== "all" && p.category !== query.category) return false;
    if (query.owner === "unassigned") {
      if (p.ownerId) return false;
    } else if (query.owner !== "all" && p.ownerId !== query.owner) {
      return false;
    }
    if (query.committedOnly && p.committedAmount <= 0) return false;
    if (query.introOnly && !(p.introPath && p.introPath.length > 0)) return false;
    if (query.needsAttention && !needsAttention(p, now)) return false;
    return true;
  });
}

// ── Sorting ──────────────────────────────────────────────────────────────────

function firstNameKey(n: string): string {
  return n.trim().split(/\s+/)[0]?.toLowerCase() ?? n.toLowerCase();
}

function lastNameKey(n: string): string {
  const parts = n.trim().split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? n)).toLowerCase();
}

function timeKey(iso: string | null): number {
  if (!iso) return -Infinity;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** Sort a copy, never the caller's array — the cached roster is shared. */
export function sortRoster(people: ActiveNetworkPerson[], sort: RosterSort): ActiveNetworkPerson[] {
  const rows = [...people];
  switch (sort) {
    case "recent":
      return rows.sort((a, b) => timeKey(b.addedAt) - timeKey(a.addedAt));
    case "first":
      return rows.sort((a, b) => firstNameKey(a.name).localeCompare(firstNameKey(b.name)));
    case "last":
      return rows.sort((a, b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name)));
    case "touch":
      return rows.sort(
        (a, b) =>
          timeKey(b.lastActivityAt ?? b.lastContactAt) - timeKey(a.lastActivityAt ?? a.lastContactAt),
      );
    case "stale":
      // Quietest first. A relationship with nothing logged is the quietest of
      // all, so it sorts above one last touched years ago rather than falling
      // to the bottom the way a plain ascending date sort would put it.
      return rows.sort((a, b) => {
        const at = timeKey(a.lastActivityAt ?? a.lastContactAt);
        const bt = timeKey(b.lastActivityAt ?? b.lastContactAt);
        if (at === bt) return b.warmth - a.warmth;
        return at - bt;
      });
    case "warmth":
    default:
      return rows.sort((a, b) => b.warmth - a.warmth || a.name.localeCompare(b.name));
  }
}

// ── Facets ───────────────────────────────────────────────────────────────────

export function computeFacets(people: ActiveNetworkPerson[], now = Date.now()): RosterFacets {
  const temperature: Record<Temperature, number> = { cold: 0, warm: 0, active: 0, committed: 0 };
  const kind: Record<PersonKind, number> = { investor: 0, contact: 0, partner: 0, provider: 0 };
  const stage: Record<ContactStage, number> = {
    prospect: 0,
    engaged: 0,
    diligence: 0,
    committed: 0,
    dormant: 0,
    passed: 0,
  };
  const categories = new Map<string, number>();
  let attention = 0;

  for (const p of people) {
    if (p.temperature) temperature[p.temperature] += 1;
    kind[p.kind] += 1;
    if (p.stage) stage[p.stage] += 1;
    if (p.category) categories.set(p.category, (categories.get(p.category) ?? 0) + 1);
    if (needsAttention(p, now)) attention += 1;
  }

  return {
    temperature,
    kind,
    stage,
    needsAttention: attention,
    categories: [...categories.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  };
}

// ── The whole query ──────────────────────────────────────────────────────────

/**
 * Filter → facet → sort → page, in that order.
 *
 * Facets are computed on the FILTERED set but before paging, so the chip counts
 * describe the result the operator is looking at rather than the page of it.
 */
export function applyRosterQuery(
  people: ActiveNetworkPerson[],
  query: RosterQuery,
  pulse?: NetworkPulse,
  now = Date.now(),
): RosterPage {
  const matched = filterRoster(people, query, now);
  const facets = computeFacets(matched, now);
  const sorted = sortRoster(matched, query.sort);
  const rows = sorted.slice(query.offset, query.offset + query.limit);
  const consumed = query.offset + rows.length;

  return {
    rows,
    total: matched.length,
    nextOffset: consumed < matched.length ? consumed : null,
    facets,
    pulse: pulse ?? computePulse(people),
  };
}

// ── Composition cache ────────────────────────────────────────────────────────
//
// Composing the roster fans out across the capital map and four tables. Paging
// through it should not re-run that on every request, so the composed array is
// held briefly per org. This is a per-instance cache: a miss is correct but
// slow, never wrong, and every entry is keyed by organization_id so one tenant
// can never be served another's roster.

interface CacheEntry {
  at: number;
  value: { people: ActiveNetworkPerson[]; pulse: NetworkPulse };
}

const CACHE_TTL_MS = 30_000;
const MAX_CACHED_ORGS = 32;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry["value"]>>();

/** Drop an org's cached roster after a write. Call this from any route that
 *  changes a contact, so the operator sees their own edit immediately. */
export function invalidateRoster(orgId: string): void {
  cache.delete(orgId);
  inflight.delete(orgId);
}

export function __resetRosterCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export async function getRoster(
  db: SupabaseClient<Database>,
  orgId: string,
  options: { fresh?: boolean } = {},
): Promise<{ people: ActiveNetworkPerson[]; pulse: NetworkPulse }> {
  if (options.fresh) invalidateRoster(orgId);

  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // Collapse concurrent misses: the page and its first roster fetch can land
  // together, and one composition is enough to serve both.
  const pending = inflight.get(orgId);
  if (pending) return pending;

  const promise = loadActiveNetwork(db, orgId)
    .then((value) => {
      // Bound the map so a multi-tenant instance cannot grow it without limit.
      if (cache.size >= MAX_CACHED_ORGS) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      cache.set(orgId, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(orgId));

  inflight.set(orgId, promise);
  return promise;
}
