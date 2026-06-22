// lib/agenda-view.ts — pure types, helpers, and source→item mappers for the
// deadlines board.
//
// This module carries NO I/O and NO server-only imports (no createServerClient,
// no next/headers), so it is safe to import from BOTH the server aggregator
// (lib/agenda.ts) and client components (AgendaControls). The aggregator
// re-exports everything here, so existing importers of "@/lib/agenda" are
// unaffected.
import type {
  DiligenceItem,
  CapitalEvent,
  Deal,
  RiskSeverity,
} from "@/lib/supabase/database.types";

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

export interface BucketCounts {
  overdue: number;
  today: number;
  week: number;
  later: number;
}

/** Per-severity tallies, plus `none` for items without a severity. */
export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  none: number;
}

export interface Agenda {
  buckets: AgendaBucket[];
  /** Flat, serializable list of every item — lets a client re-group. */
  items: AgendaItem[];
  total: number;
  overdue: number;
  /** Short headline like "3 overdue · 2 due today". */
  summary: string;
  counts: BucketCounts;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — safe to import directly in tests and client code)
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

/** Tally items into each bucket relative to `now`. */
export function bucketCounts(
  items: AgendaItem[],
  now: Date = new Date(),
): BucketCounts {
  const counts: BucketCounts = { overdue: 0, today: 0, week: 0, later: 0 };
  for (const item of items) {
    counts[bucketFor(item.when, now)] += 1;
  }
  return counts;
}

/** Tally items by severity; items without a severity land in `none`. */
export function severityCounts(items: AgendaItem[]): SeverityCounts {
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };
  for (const item of items) {
    if (item.severity) counts[item.severity] += 1;
    else counts.none += 1;
  }
  return counts;
}

/**
 * A short headline summarizing the board, e.g. "3 overdue · 2 due today ·
 * 5 this week". Omits zero segments; returns "Nothing scheduled" when empty.
 */
export function agendaSummaryLine(
  items: AgendaItem[],
  now: Date = new Date(),
): string {
  if (items.length === 0) return "Nothing scheduled";
  const c = bucketCounts(items, now);
  const parts: string[] = [];
  if (c.overdue > 0) parts.push(`${c.overdue} overdue`);
  if (c.today > 0) parts.push(`${c.today} due today`);
  if (c.week > 0) parts.push(`${c.week} this week`);
  if (c.later > 0) parts.push(`${c.later} later`);
  return parts.join(" · ");
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
