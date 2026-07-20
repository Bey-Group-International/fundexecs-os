"use server";

// Server actions + reads for the Virtual Office analytics track.
//
// - recordPresenceEvent: append one presence row, but ONLY for a member who has
//   opted in. Best-effort — it never throws, so wiring it into the office shell
//   (join/leave/room-change) can never break a render.
// - fetchOfficeAnalytics: read the org's recent presence stream and fold it into
//   an AnalyticsSummary via the pure `aggregatePresence`.
// - getMyAnalyticsPref / setMyAnalyticsPref: the acting member's opt-in toggle.
//
// The opt-in model is enforced twice: the DB RLS restricts inserts to the acting
// principal, and `recordPresenceEvent` refuses to write at all unless that
// member's `office_member_prefs.analytics_opt_in` is true.
//
// Both tables are new and not yet in the generated DB types, so (exactly like
// app/(app)/office/actions.ts) the client is reached through a narrow
// unknown-cast until `database.types.ts` is regenerated.
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  aggregatePresence,
  emptyAnalyticsSummary,
  type AnalyticsSummary,
  type PresenceEvent,
} from "./analytics";

// How far back / how many rows the dashboard scans. Bounded so a busy org stays
// cheap; two weeks of recent activity is plenty for the aggregate view.
const WINDOW_DAYS = 14;
const MAX_ROWS = 5000;

type LooseResult = Promise<{ data: unknown; error: { message: string } | null }>;
interface LooseQuery {
  eq: (col: string, val: string) => LooseQuery;
  gte: (col: string, val: string) => LooseQuery;
  order: (col: string, opts: { ascending: boolean }) => LooseQuery;
  limit: (n: number) => LooseResult;
  maybeSingle: () => LooseResult;
}
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => LooseQuery;
    insert: (row: Record<string, unknown>) => LooseResult;
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => LooseResult;
  };
};

/** DB row shape for a presence event (only the columns we read). */
interface PresenceRow {
  principal_id: string;
  kind: PresenceEvent["kind"];
  room_key: string | null;
  status: string | null;
  created_at: string;
}

/** True if this member has opted into analytics in the given org. */
async function isOptedIn(
  supabase: LooseClient,
  orgId: string,
  principalId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("office_member_prefs")
    .select("analytics_opt_in")
    .eq("organization_id", orgId)
    .eq("principal_id", principalId)
    .maybeSingle();
  const row = data as { analytics_opt_in?: boolean } | null;
  return Boolean(row?.analytics_opt_in);
}

/**
 * Append one presence event for the acting member, but only if Supabase is
 * configured, the member is in `orgId`, and they have opted into analytics.
 * A no-op on missing env / not opted in / any error; never throws.
 */
export async function recordPresenceEvent(input: {
  orgId: string;
  kind: PresenceEvent["kind"];
  roomKey?: string;
  status?: string;
}): Promise<void> {
  try {
    if (!hasSupabaseServerEnv() || !input.orgId) return;
    const ctx = await getSessionContext();
    // Only record against the member's own active org.
    if (!ctx?.orgId || ctx.orgId !== input.orgId) return;

    const supabase = (await createServerClient()) as unknown as LooseClient;
    if (!(await isOptedIn(supabase, input.orgId, ctx.userId))) return;

    await supabase.from("office_presence_events").insert({
      organization_id: input.orgId,
      principal_id: ctx.userId,
      kind: input.kind,
      room_key: input.roomKey ?? null,
      status: input.status ?? null,
    });
  } catch {
    // Presence recording is best-effort — swallow any failure.
  }
}

/**
 * Read the org's recent presence stream and aggregate it. Returns the empty
 * summary when Supabase is unconfigured or on any query error; never throws.
 * `now` is supplied by the caller (a server component) so the pure aggregation
 * stays clock-free.
 */
export async function fetchOfficeAnalytics(
  orgId: string,
  now: number,
): Promise<AnalyticsSummary> {
  if (!hasSupabaseServerEnv() || !orgId) return emptyAnalyticsSummary();

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const sinceIso = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("office_presence_events")
      .select("principal_id, kind, room_key, status, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    if (error) return emptyAnalyticsSummary();

    const rows = (data as PresenceRow[] | null) ?? [];
    const events: PresenceEvent[] = rows.map((row) => ({
      principalId: row.principal_id,
      kind: row.kind,
      roomKey: row.room_key,
      status: row.status,
      at: Date.parse(row.created_at),
    }));

    return aggregatePresence(events, now);
  } catch {
    return emptyAnalyticsSummary();
  }
}

/**
 * The acting member's analytics opt-in flag in `orgId`. Defaults to false when
 * unconfigured, unauthenticated, or on error.
 */
export async function getMyAnalyticsPref(orgId: string): Promise<boolean> {
  try {
    if (!hasSupabaseServerEnv() || !orgId) return false;
    const ctx = await getSessionContext();
    if (!ctx?.orgId || ctx.orgId !== orgId) return false;
    const supabase = (await createServerClient()) as unknown as LooseClient;
    return await isOptedIn(supabase, orgId, ctx.userId);
  } catch {
    return false;
  }
}

/**
 * Set the acting member's analytics opt-in flag in `orgId` (upsert on the
 * composite PK). Returns the persisted value, or the requested value optimistically
 * when it cannot confirm; never throws.
 */
export async function setMyAnalyticsPref(
  orgId: string,
  optIn: boolean,
): Promise<{ ok: boolean; optIn: boolean }> {
  try {
    if (!hasSupabaseServerEnv() || !orgId) return { ok: false, optIn };
    const ctx = await getSessionContext();
    if (!ctx?.orgId || ctx.orgId !== orgId) return { ok: false, optIn };

    const supabase = (await createServerClient()) as unknown as LooseClient;
    const { error } = await supabase.from("office_member_prefs").upsert(
      {
        organization_id: orgId,
        principal_id: ctx.userId,
        analytics_opt_in: optIn,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );
    if (error) return { ok: false, optIn };
    return { ok: true, optIn };
  } catch {
    return { ok: false, optIn };
  }
}
