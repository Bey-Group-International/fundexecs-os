// lib/radar-scan.ts
// The org-scoped Radar signal scan as a reusable, SESSION-LESS service so the
// scheduled cron sweep (app/api/cron/route.ts) can keep the "act now" list fresh
// automatically — turning Radar from pull (an operator clicks "scan") into push
// (the hourly sweep tops up due orgs).
//
// The interactive server action (scanRadarSignals in source-radar-actions.ts)
// resolves the org from the user session; the cron path has no session, so the
// caller passes the service-role client + org id explicitly here.
//
// Mirrors the codebase convention (lib/source-radar.ts, lib/sourcing-signals.ts):
// the SELECTION / STALENESS helpers are PURE (no DB, no key, fully unit-testable,
// exported under __test), and the DB-touching scan is a thin, best-effort wrapper
// that reuses the existing signal generation seam (generateSignals/recordSignals),
// so it works deterministically in CI/preview with no ANTHROPIC_API_KEY.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { generateSignals, recordSignals } from "@/lib/sourcing-signals";

// Service-role client — RLS-bypassing, so every query below MUST be scoped to an
// explicit organization_id. Never derive the acting org from the client itself.
type ServiceClient = SupabaseClient<Database>;

const HOUR = 60 * 60 * 1000;

// Cap orgs touched per sweep so the Anthropic/signal budget can't run away when a
// backlog of stale orgs piles up; the next sweep picks up the remainder. Mirrors
// MAX_PER_SWEEP in app/api/cron/route.ts.
export const MAX_ORGS_PER_SWEEP = 5;

// Default entities scanned per org per run (kept modest to bound cost per sweep).
const DEFAULT_PER_ORG_LIMIT = 10;

// How many catalog entities to consider per org before filtering to the ones
// without signals yet (matches the interactive action's window).
const ENTITY_WINDOW = 60;

// ===========================================================================
// PURE — staleness + org selection (no DB, no key, unit-testable)
// ===========================================================================

/**
 * Is an org due for a re-scan? An org is due when it has never been scanned
 * (no prior signal → `lastScanIso` null/empty/unparseable) or its most recent
 * signal is older than `minIntervalHours`. This is the once-per-day guard that
 * stops the sweep rescanning the same org every hour. Pure.
 */
export function isOrgScanDue(
  lastScanIso: string | null | undefined,
  now: number = Date.now(),
  minIntervalHours = 24,
): boolean {
  if (!lastScanIso) return true;
  const t = new Date(lastScanIso).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t >= minIntervalHours * HOUR;
}

/**
 * Given each org's most-recent-signal timestamp, return the org ids that are due
 * for a scan, oldest first (orgs that have never been scanned sort first), capped
 * at `max`. Derives staleness from the latest entity_signals.created_at per org —
 * no extra column or migration needed. Pure + deterministic.
 */
export function selectDueOrgs(
  orgs: { orgId: string; lastSignalAt: string | null | undefined }[],
  now: number = Date.now(),
  opts: { minIntervalHours?: number; max?: number } = {},
): string[] {
  const minIntervalHours = opts.minIntervalHours ?? 24;
  const max = opts.max ?? MAX_ORGS_PER_SWEEP;
  return orgs
    .filter((o) => o.orgId && isOrgScanDue(o.lastSignalAt, now, minIntervalHours))
    .map((o) => {
      const parsed = o.lastSignalAt ? new Date(o.lastSignalAt).getTime() : NaN;
      // never-scanned / unparseable is the stalest → sort to the front (-Inf).
      return { orgId: o.orgId, t: Number.isFinite(parsed) ? parsed : -Infinity };
    })
    .sort((a, b) => a.t - b.t)
    .slice(0, Math.max(0, max))
    .map((o) => o.orgId);
}

// ===========================================================================
// DB — the session-less, org-scoped scan (best-effort)
// ===========================================================================

export interface ScanOrgOptions {
  /** Max entities to generate signals for in this run. */
  limit?: number;
  /** Attribute generated signals to this user id (null for system runs). */
  userId?: string | null;
}

export interface ScanOrgResult {
  /** Signals inserted across all scanned entities. */
  generated: number;
  /** Catalog entities the scan generated signals for. */
  scanned: number;
}

/**
 * Run the Radar signal scan for ONE organization without a user session: pick the
 * highest-priority catalog entities that don't have any signals yet and generate
 * signals for them (deterministic fallback when there's no model key) — the
 * "why now" half of the radar score. Best-effort: returns zero counts on any
 * read failure rather than throwing, so one bad org can't abort the sweep.
 *
 * This is the same core logic as the interactive scanRadarSignals action, lifted
 * here so the cron route can call it with a service-role client + explicit orgId.
 */
export async function scanOrgRadarSignals(
  supabase: ServiceClient,
  orgId: string,
  opts: ScanOrgOptions = {},
): Promise<ScanOrgResult> {
  const limit = opts.limit ?? DEFAULT_PER_ORG_LIMIT;
  const userId = opts.userId ?? null;
  if (!orgId) return { generated: 0, scanned: 0 };

  // Catalog entities, newest first.
  const { data: entityData } = await supabase
    .from("sourcing_entities")
    .select("id, name, kind, description")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(ENTITY_WINDOW);
  const entities = (entityData ?? []) as {
    id: string;
    name: string;
    kind: string;
    description: string | null;
  }[];
  if (entities.length === 0) return { generated: 0, scanned: 0 };

  // Which already have signals — skip them so a scan is additive, not noisy.
  const { data: sigData } = await supabase
    .from("entity_signals")
    .select("entity_id")
    .eq("organization_id", orgId)
    .not("entity_id", "is", null)
    .limit(1000);
  const haveSignals = new Set(
    ((sigData ?? []) as { entity_id: string | null }[]).map((r) => r.entity_id),
  );

  const targets = entities.filter((e) => !haveSignals.has(e.id)).slice(0, limit);
  let generated = 0;
  for (const e of targets) {
    const signals = await generateSignals({
      entityId: e.id,
      name: e.name,
      kind: e.kind,
      description: e.description,
    });
    if (signals.length) generated += await recordSignals(supabase, orgId, userId, signals);
  }
  return { generated, scanned: targets.length };
}

/**
 * Discover which orgs are due for a scan from the catalog itself: read the most
 * recent signal timestamp per org (best-effort), then apply the pure staleness +
 * cap rules. Returns the due org ids, oldest first, capped at MAX_ORGS_PER_SWEEP.
 *
 * Orgs with catalog entities but no signals yet won't appear in entity_signals,
 * so we also fold in distinct org ids from sourcing_entities — those are the
 * never-scanned orgs and the most important to light up.
 */
export async function findDueOrgsForScan(
  supabase: ServiceClient,
  now: Date = new Date(),
  opts: { minIntervalHours?: number; max?: number; lookback?: number } = {},
): Promise<string[]> {
  const lookback = opts.lookback ?? 2000;

  // Most-recent-first signals → first time we see an org is its latest signal.
  const lastSignalAt = new Map<string, string>();
  try {
    const { data } = await supabase
      .from("entity_signals")
      .select("organization_id, created_at")
      .order("created_at", { ascending: false })
      .limit(lookback);
    for (const r of (data ?? []) as { organization_id: string; created_at: string }[]) {
      if (r.organization_id && !lastSignalAt.has(r.organization_id)) {
        lastSignalAt.set(r.organization_id, r.created_at);
      }
    }
  } catch {
    // best-effort — fall through with whatever we have
  }

  // Orgs that own catalog entities but may have no signals yet (never scanned).
  const orgIds = new Set<string>(lastSignalAt.keys());
  try {
    const { data } = await supabase
      .from("sourcing_entities")
      .select("organization_id")
      .limit(lookback);
    for (const r of (data ?? []) as { organization_id: string }[]) {
      if (r.organization_id) orgIds.add(r.organization_id);
    }
  } catch {
    // best-effort
  }

  const orgs = [...orgIds].map((orgId) => ({
    orgId,
    lastSignalAt: lastSignalAt.get(orgId) ?? null,
  }));
  return selectDueOrgs(orgs, now.getTime(), opts);
}

export const __test = {
  isOrgScanDue,
  selectDueOrgs,
  MAX_ORGS_PER_SWEEP,
};
