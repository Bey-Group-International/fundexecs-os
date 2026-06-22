// lib/agenda.ts — the deadlines board aggregator.
//
// One time-ordered board of every DATED obligation across the platform, so the
// operator never misses a deadline. It pulls due/target dates from multiple
// tables (diligence items, capital events, deals), normalizes each into a
// uniform `AgendaItem`, and groups them into Overdue / Today / This week /
// Later. Read-only aggregation, best-effort: any read failure degrades to an
// empty list rather than breaking the page.
//
// The pure types, helpers, and source→item mappers live in `lib/agenda-view`
// (no server imports) so they are safe to import from client components and
// unit tests. This module adds only the I/O — the cached `getAgenda` read — and
// re-exports the pure surface so existing importers of "@/lib/agenda" are
// unaffected.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { DiligenceItem, CapitalEvent, Deal } from "@/lib/supabase/database.types";
import {
  type Agenda,
  type AgendaItem,
  agendaCount,
  agendaSummaryLine,
  bucketCounts,
  capitalEventToItem,
  dealToItem,
  diligenceToItem,
  groupAgenda,
  overdueCount,
} from "@/lib/agenda-view";

export * from "@/lib/agenda-view";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

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
  const empty: Agenda = {
    buckets: [],
    items: [],
    total: 0,
    overdue: 0,
    summary: agendaSummaryLine([]),
    counts: bucketCounts([]),
  };
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
    items,
    total: agendaCount(items),
    overdue: overdueCount(items),
    summary: agendaSummaryLine(items),
    counts: bucketCounts(items),
  };
});
