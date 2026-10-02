// lib/integrations/gmail-sync/sync.server.ts
// The hourly mailbox sweep: each org's connected Gmail account, into the inbox.
//
// Incremental by Gmail's history cursor. The first run takes a bounded window
// of recent mail (BACKFILL_DAYS, at most BACKFILL_MAX messages); every run
// after that asks Gmail only for what was added since the cursor, which on a
// quiet mailbox is one request that returns nothing. Messages go through
// mapGmailMessage (pure, ./map.ts) and then ingestInboundEvent — the same path
// as the webhooks — so a synced message is claimed once, threaded, and written
// onto the contact's timeline exactly like any other.
//
// Bounded everywhere, because it runs inside the shared hourly cron:
//   - MAX_ORGS mailboxes per sweep, stalest first;
//   - MAX_MESSAGES fetched per mailbox per run. When a mailbox has more new mail
//     than that, the cursor is NOT advanced: the next run re-reads the same
//     history, skips everything already in ingest_log with one indexed query,
//     and carries on where this one stopped;
//   - every Gmail request has a timeout.
//
// Never throws. One org's revoked grant must not stop another org's sync, and
// the cron's other sweeps must not wait on any of it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getGoogleAccessToken, googleOAuthConfigured } from "@/lib/google-oauth";
import { ingestInboundEvent } from "@/lib/integrations/inbound/ingest";
import { mapGmailMessage, type GmailMessage } from "@/lib/integrations/gmail-sync/map";

type Client = SupabaseClient<Database>;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** The ingest_log channel synced messages are claimed under. */
export const SYNC_CHANNEL = "gmail_sync";

export const MAX_ORGS = 10;
export const MAX_MESSAGES = 150;
export const BACKFILL_DAYS = 14;
export const BACKFILL_MAX = 100;
/** A mailbox synced more recently than this is left for the next sweep. */
export const MIN_INTERVAL_MS = 45 * 60 * 1000;
const HISTORY_PAGES = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const FETCH_CONCURRENCY = 5;

export interface MailboxSyncResult {
  orgId: string;
  status: "ok" | "needs_reconnect" | "error" | "skipped";
  fetched: number;
  ingested: number;
  skipped: number;
  /** True when more mail is waiting than one run takes. */
  incomplete: boolean;
}

export interface MailboxSweepSummary {
  mailboxes: number;
  ingested: number;
  failed: number;
  needsReconnect: number;
  incomplete: boolean;
}

type FetchLike = typeof fetch;

class GmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gmail<T>(fetchImpl: FetchLike, token: string, path: string): Promise<T> {
  const res = await fetchImpl(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new GmailError(res.status, `gmail ${path.split("?")[0]} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** The message ids Gmail has added since the cursor, and the cursor to resume from. */
async function newMessageIds(
  fetchImpl: FetchLike,
  token: string,
  startHistoryId: string,
): Promise<{ ids: string[]; historyId: string; complete: boolean }> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const body = await gmail<{
      history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
      historyId?: string;
      nextPageToken?: string;
    }>(fetchImpl, token, `/history?${params}`);
    for (const h of body.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    if (body.historyId) historyId = body.historyId;
    pageToken = body.nextPageToken;
    if (!pageToken) return { ids, historyId, complete: true };
  }
  return { ids, historyId, complete: false };
}

/** Recent mail for a first sync, oldest first so threads build in order. */
async function backfillIds(fetchImpl: FetchLike, token: string): Promise<string[]> {
  const params = new URLSearchParams({
    q: `newer_than:${BACKFILL_DAYS}d -in:chats -in:spam -in:trash -category:promotions -category:social`,
    maxResults: String(BACKFILL_MAX),
  });
  const body = await gmail<{ messages?: Array<{ id?: string }> }>(fetchImpl, token, `/messages?${params}`);
  return (body.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).reverse();
}

/** Of these Gmail ids, the ones this org has already ingested. One indexed read. */
async function alreadyIngested(client: Client, orgId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await client
    .from("ingest_log")
    .select("external_id")
    .eq("organization_id", orgId)
    .eq("channel", SYNC_CHANNEL)
    .in(
      "external_id",
      ids.map((id) => `gmail:${id}`),
    );
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => String(r.external_id).slice("gmail:".length)));
}

/**
 * Sync one org's mailbox. Exported for the "Sync now" path and for tests; the
 * sweep below is what the cron calls.
 */
export async function syncOrgMailbox(
  client: Client,
  orgId: string,
  opts: { fetchImpl?: FetchLike; now?: Date; accessToken?: string | null } = {},
): Promise<MailboxSyncResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = (opts.now ?? new Date()).toISOString();
  const result: MailboxSyncResult = {
    orgId,
    status: "ok",
    fetched: 0,
    ingested: 0,
    skipped: 0,
    incomplete: false,
  };

  const { data: state } = await client
    .from("gmail_mailbox_sync")
    .select("history_id, mailbox_email, consecutive_failures, messages_ingested")
    .eq("organization_id", orgId)
    .maybeSingle();

  const save = async (fields: Partial<Database["public"]["Tables"]["gmail_mailbox_sync"]["Row"]>) => {
    const { error } = await client
      .from("gmail_mailbox_sync")
      .upsert({ organization_id: orgId, ...fields }, { onConflict: "organization_id" });
    if (error) console.error("[gmail-sync] state write failed", error.message);
  };

  const token =
    opts.accessToken !== undefined ? opts.accessToken : await getGoogleAccessToken(orgId);
  if (!token) {
    await save({ status: "needs_reconnect", last_error: "No usable Google grant", last_synced_at: now });
    return { ...result, status: "needs_reconnect" };
  }

  try {
    let mailbox = state?.mailbox_email ?? null;
    const cursor = state?.history_id ?? null;
    let ids: string[];
    // Set by whichever read below establishes it.
    let nextCursor = "";
    let complete = true;

    if (!cursor || !mailbox) {
      // Taken BEFORE the backfill list, so mail that lands between the two
      // calls is in the next run's history rather than in neither.
      const profile = await gmail<{ emailAddress?: string; historyId?: string }>(
        fetchImpl,
        token,
        "/profile",
      );
      mailbox = profile.emailAddress ?? null;
      if (!mailbox || !profile.historyId) throw new Error("gmail profile incomplete");
      nextCursor = profile.historyId;
    }

    if (!cursor) {
      ids = await backfillIds(fetchImpl, token);
    } else {
      try {
        const fresh = await newMessageIds(fetchImpl, token, cursor);
        ids = fresh.ids;
        nextCursor = fresh.historyId;
        complete = fresh.complete;
      } catch (err) {
        // Gmail keeps about a week of history. A cursor older than that is
        // answered 404, and the only way back is a fresh backfill.
        if (err instanceof GmailError && err.status === 404) {
          await save({ history_id: null, status: "pending", last_error: "History expired; re-syncing" });
          return { ...result, status: "skipped", incomplete: true };
        }
        throw err;
      }
    }

    const done = await alreadyIngested(client, orgId, ids);
    const pending = ids.filter((id) => !done.has(id));
    const batch = pending.slice(0, MAX_MESSAGES);
    if (pending.length > batch.length || !complete) result.incomplete = true;

    const messages = await mapLimited(batch, FETCH_CONCURRENCY, async (id) => {
      try {
        return await gmail<GmailMessage>(fetchImpl, token, `/messages/${encodeURIComponent(id)}?format=full`);
      } catch (err) {
        // Deleted between the history read and this one: nothing to ingest.
        if (err instanceof GmailError && err.status === 404) return null;
        throw err;
      }
    });

    // Sequential on purpose: two messages of one new thread must not race to
    // create it twice.
    for (const message of messages) {
      if (!message) continue;
      result.fetched++;
      const mapped = mapGmailMessage(message, mailbox!);
      if (!mapped.ok) {
        result.skipped++;
        // Claimed all the same. A run that stops early re-reads the same
        // history, and without a claim it would fetch the same newsletters
        // again — and, past MAX_MESSAGES of them, never get any further.
        await client.from("ingest_log").insert({
          organization_id: orgId,
          channel: SYNC_CHANNEL,
          event_type: "gmail.skipped",
          external_id: `gmail:${message.id}`,
          ok: true,
          detail: `skipped: ${mapped.reason}`,
        });
        continue;
      }
      const ingested = await ingestInboundEvent(client, orgId, SYNC_CHANNEL, mapped.event);
      if (!ingested.ok) {
        console.warn("[gmail-sync] ingest failed", ingested.error);
        continue;
      }
      if (!ingested.duplicate) result.ingested++;
    }

    await save({
      mailbox_email: mailbox,
      // Only advanced once everything up to it has been read. Otherwise the next
      // run starts from the same place and the ingest_log check skips what this
      // one already did.
      history_id: result.incomplete ? (cursor ?? null) : nextCursor,
      status: "ok",
      last_error: null,
      last_synced_at: now,
      consecutive_failures: 0,
      messages_ingested: Number(state?.messages_ingested ?? 0) + result.ingested,
    });
    return result;
  } catch (err) {
    const status = err instanceof GmailError ? err.status : 0;
    // 401: the grant is gone. 403: the grant predates the read scope, or the
    // admin unticked it on the consent screen. Either way somebody has to
    // reconnect, and saying so is the useful answer.
    const reconnect = status === 401 || status === 403;
    await save({
      status: reconnect ? "needs_reconnect" : "error",
      last_error: err instanceof Error ? err.message.slice(0, 500) : "sync failed",
      last_synced_at: now,
      consecutive_failures: Number(state?.consecutive_failures ?? 0) + 1,
    });
    return { ...result, status: reconnect ? "needs_reconnect" : "error" };
  }
}

/**
 * Whether this mailbox is due. Failing mailboxes back off: one hour per
 * consecutive failure, capped at a day, so a revoked grant is not retried
 * twenty-four times a day forever.
 */
export function isMailboxDue(
  row: { last_synced_at: string | null; consecutive_failures: number } | null,
  now: Date,
): boolean {
  if (!row?.last_synced_at) return true;
  const last = Date.parse(row.last_synced_at);
  if (Number.isNaN(last)) return true;
  const backoff = Math.min(row.consecutive_failures, 24) * 60 * 60 * 1000;
  return now.getTime() - last >= MIN_INTERVAL_MS + backoff;
}

/** The cron entry point: every org with a connected Google mailbox, stalest first. */
export async function syncConnectedMailboxes(
  client: Client,
  opts: { now?: Date; limit?: number; fetchImpl?: FetchLike } = {},
): Promise<MailboxSweepSummary> {
  const summary: MailboxSweepSummary = {
    mailboxes: 0,
    ingested: 0,
    failed: 0,
    needsReconnect: 0,
    incomplete: false,
  };
  if (!googleOAuthConfigured()) return summary;
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? MAX_ORGS;

  // Only the OAuth grant reads mail. A Composio-gateway Gmail connection has
  // its own account_ref and no refresh token in the vault.
  const { data: conns, error } = await client
    .from("integration_connections")
    .select("organization_id")
    .eq("channel", "gmail")
    .eq("status", "connected")
    .like("account_ref", "google-oauth:%");
  if (error) {
    console.error("[gmail-sync] connection query failed", error.message);
    return summary;
  }
  const orgIds = [...new Set((conns ?? []).map((c) => c.organization_id))];
  if (orgIds.length === 0) return summary;

  const { data: states } = await client
    .from("gmail_mailbox_sync")
    .select("organization_id, last_synced_at, consecutive_failures")
    .in("organization_id", orgIds);
  const stateByOrg = new Map((states ?? []).map((s) => [s.organization_id, s]));

  const due = orgIds
    .filter((id) => isMailboxDue(stateByOrg.get(id) ?? null, now))
    .sort((a, b) => {
      const at = stateByOrg.get(a)?.last_synced_at ?? "";
      const bt = stateByOrg.get(b)?.last_synced_at ?? "";
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
  if (due.length > limit) summary.incomplete = true;

  for (const orgId of due.slice(0, limit)) {
    try {
      const r = await syncOrgMailbox(client, orgId, { fetchImpl: opts.fetchImpl, now });
      summary.mailboxes++;
      summary.ingested += r.ingested;
      if (r.status === "error") summary.failed++;
      if (r.status === "needs_reconnect") summary.needsReconnect++;
      summary.incomplete = summary.incomplete || r.incomplete;
    } catch (err) {
      summary.failed++;
      console.error("[gmail-sync] mailbox sync threw", err);
    }
  }
  return summary;
}
