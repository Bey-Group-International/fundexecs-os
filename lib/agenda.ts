// lib/agenda.ts — the deadlines board aggregator.
//
// One time-ordered board of every DATED obligation across the platform, so the
// operator never misses a deadline. It pulls due/target dates from multiple
// tables (diligence items, capital events, deals), normalizes each into a
// uniform `AgendaItem`, and groups them into Overdue / Today / This week /
// Later. Read-only aggregation, best-effort: any read failure degrades to an
// empty list rather than breaking the page.
//
// The pure helpers (daysUntil / bucketFor / relativeDue / severityRank /
// compareAgendaItems / groupAgenda / agendaCount / overdueCount) carry no I/O
// and no `react` import, so they are unit-testable in jest without a DB or RSC
// runtime.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import type {
  DiligenceItem,
  CapitalEvent,
  Deal,
  RiskSeverity,
} from "@/lib/supabase/database.types";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

export type AgendaKind = "diligence" | "capital" | "deal";

export type AgendaBucketKey = "overdue" | "today" | "week" | "later";

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  /** ISO date (YYYY-MM-DD) the obligation is due / targeted. */
  when: string;
  category: string;
  severity?: RiskSeverity;
  href: string;
  meta?: string;
}

export interface AgendaBucket {
  key: AgendaBucketKey;
  label: string;
  items: AgendaItem[];
}

export interface Agenda {
  buckets: AgendaBucket[];
  total: number;
  overdue: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — safe to import directly in tests)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Midnight (local) of a date, for whole-day comparisons. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole calendar days from `now` until `iso`. Negative = overdue, 0 = due
 * today, positive = upcoming. Both ends are floored to local midnight so the
 * result counts day boundaries rather than elapsed hours.
 */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return NaN;
  return Math.round((startOfDay(then) - startOfDay(now)) / DAY_MS);
}

/**
 * Which board bucket an ISO date falls into relative to `now`:
 * - "overdue" — strictly before today
 * - "today"   — today
 * - "week"    — within the next 7 days (tomorrow … +7)
 * - "later"   — beyond 7 days
 */
export function bucketFor(iso: string, now: Date = new Date()): AgendaBucketKey {
  const d = daysUntil(iso, now);
  if (Number.isNaN(d)) return "later";
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  return "later";
}

/**
 * A short relative-due label: "overdue 3d", "today", "in 2d", "in 3w".
 * Weeks kick in once a date is a full week or more out.
 */
export function relativeDue(iso: string, now: Date = new Date()): string {
  const d = daysUntil(iso, now);
  if (Number.isNaN(d)) return "";
  if (d < 0) {
    const overdue = -d;
    if (overdue >= 7) return `overdue ${Math.floor(overdue / 7)}w`;
    return `overdue ${overdue}d`;
  }
  if (d === 0) return "today";
  if (d >= 7) return `in ${Math.floor(d / 7)}w`;
  return `in ${d}d`;
}

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Numeric weight for a risk severity; higher = more urgent. Absent → 0. */
export function severityRank(sev?: RiskSeverity | null): number {
  if (!sev) return 0;
  return SEVERITY_RANK[sev] ?? 0;
}

/**
 * Order two agenda items: overdue first, then by soonest date, then by
 * descending severity. Stable enough to drive both bucket ordering and the
 * within-bucket sort.
 */
export function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  const ta = new Date(a.when).getTime();
  const tb = new Date(b.when).getTime();
  const na = Number.isNaN(ta);
  const nb = Number.isNaN(tb);
  if (na && nb) return severityRank(b.severity) - severityRank(a.severity);
  if (na) return 1;
  if (nb) return -1;
  if (ta !== tb) return ta - tb; // soonest first (overdue dates are earliest)
  return severityRank(b.severity) - severityRank(a.severity);
}

const BUCKET_ORDER: { key: AgendaBucketKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
];

/**
 * Group items into the four ordered buckets, each internally sorted by
 * `compareAgendaItems`. Empty buckets are omitted.
 */
export function groupAgenda(
  items: AgendaItem[],
  now: Date = new Date(),
): AgendaBucket[] {
  const byKey = new Map<AgendaBucketKey, AgendaItem[]>();
  for (const item of items) {
    const key = bucketFor(item.when, now);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }

  return BUCKET_ORDER.map(({ key, label }) => {
    const list = byKey.get(key);
    if (!list || list.length === 0) return null;
    return { key, label, items: list.slice().sort(compareAgendaItems) };
  }).filter((b): b is AgendaBucket => b !== null);
}

/** Total number of agenda items. */
export function agendaCount(items: AgendaItem[]): number {
  return items.length;
}

/** How many items are overdue relative to `now`. */
export function overdueCount(items: AgendaItem[], now: Date = new Date()): number {
  return items.filter((item) => bucketFor(item.when, now) === "overdue").length;
}

// ---------------------------------------------------------------------------
// Source → AgendaItem mappers (pure)
// ---------------------------------------------------------------------------

const CLEARED_DILIGENCE: ReadonlySet<string> = new Set(["cleared", "waived"]);

/** Shape an open, dated diligence item into an AgendaItem. */
export function diligenceToItem(row: DiligenceItem): AgendaItem | null {
  if (!row.due_date) return null;
  if (CLEARED_DILIGENCE.has(row.status)) return null;
  return {
    id: `diligence:${row.id}`,
    kind: "diligence",
    title: row.title,
    when: row.due_date,
    category: row.category,
    severity: row.risk_severity ?? undefined,
    href: `/deal/${row.deal_id}`,
    meta: row.owner ?? undefined,
  };
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

/** Shape a dated capital event (e.g. a capital call) into an AgendaItem. */
export function capitalEventToItem(row: CapitalEvent): AgendaItem | null {
  if (!row.due_date) return null;
  const label =
    row.event_type === "capital_call"
      ? "Capital call"
      : row.event_type.charAt(0).toUpperCase() +
        row.event_type.slice(1).replace(/_/g, " ");
  const detail = row.reference?.trim() || formatAmount(row.amount, row.currency);
  return {
    id: `capital:${row.id}`,
    kind: "capital",
    title: `${label} — ${detail}`,
    when: row.due_date,
    category: row.event_type,
    href: "/execute",
    meta: row.notes?.trim() || undefined,
  };
}

const TERMINAL_DEAL_STAGES: ReadonlySet<string> = new Set([
  "closed_won",
  "closed_lost",
  "passed",
  "dead",
  "owned",
  "exited",
]);

/** Shape a deal with a live expected-close date into an AgendaItem. */
export function dealToItem(row: Deal): AgendaItem | null {
  if (!row.expected_close) return null;
  if (TERMINAL_DEAL_STAGES.has(row.stage)) return null;
  return {
    id: `deal:${row.id}`,
    kind: "deal",
    title: `Target close — ${row.name}`,
    when: row.expected_close,
    category: row.stage,
    href: `/deal/${row.id}`,
    meta: row.stage,
  };
}

// ---------------------------------------------------------------------------
// Aggregator (I/O)
// ---------------------------------------------------------------------------

/** Best-effort read of one table scoped to the org; failure → []. */
async function readRows<T>(
  read: () => PromiseLike<{ data: unknown }>,
): Promise<T[]> {
  try {
    const { data } = await read();
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

/**
 * Read the org's full deadlines board: open dated diligence items, dated
 * capital events, and live deals with a target close — normalized into
 * AgendaItems and grouped into Overdue / Today / This week / Later.
 *
 * Wrapped in `cache` so multiple consumers in one RSC render share the read.
 */
export const getAgenda = cache(async (orgId: string): Promise<Agenda> => {
  const empty: Agenda = { buckets: [], total: 0, overdue: 0 };
  if (!orgId) return empty;

  const supabase = createServerClient();

  const [diligenceRows, capitalRows, dealRows] = await Promise.all([
    readRows<DiligenceItem>(() =>
      supabase
        .from("diligence_items")
        .select("*")
        .eq("organization_id", orgId)
        .not("due_date", "is", null),
    ),
    readRows<CapitalEvent>(() =>
      supabase
        .from("capital_events")
        .select("*")
        .eq("organization_id", orgId)
        .not("due_date", "is", null),
    ),
    readRows<Deal>(() =>
      supabase
        .from("deals")
        .select("*")
        .eq("organization_id", orgId)
        .not("expected_close", "is", null),
    ),
  ]);

  const items: AgendaItem[] = [
    ...diligenceRows.map(diligenceToItem),
    ...capitalRows.map(capitalEventToItem),
    ...dealRows.map(dealToItem),
  ].filter((item): item is AgendaItem => item !== null);

  return {
    buckets: groupAgenda(items),
    total: agendaCount(items),
    overdue: overdueCount(items),
  };
});
