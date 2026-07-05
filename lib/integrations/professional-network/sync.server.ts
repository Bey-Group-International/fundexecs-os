// Server-side backend-connector sync orchestration for the Professional
// Network layer. Backend connectors (Google Contacts, official LinkedIn API,
// future CRM) are the PRIMARY input path; CSV stays the fallback.
//
// runProviderSync records every attempt in professional_network_sync_jobs so
// the org keeps an audit trail and the UI can show last-sync status per
// provider. It is honest about credential-gated availability: a connector with
// no credentials produces a well-formed 'paused' job with the user-facing
// reason — never a broken button, never a fake success.
//
// Real record ingestion routes through addProfessionalContact (pipeline.server)
// so every source lands identically in the Capital Relationship Graph. Because
// no provider credentials exist in this environment, the live pull stays a
// seam documented with TODO(oauth).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ProfessionalNetworkSyncJob } from "@/lib/supabase/database.types";
import { PROFESSIONAL_NETWORK_CONNECTORS } from "./connectors";
import type { ProfessionalNetworkSource } from "./types";

type Client = SupabaseClient<Database>;

export type SyncType = "initial" | "incremental" | "manual_refresh";

export type RunProviderSyncArgs = {
  orgId: string;
  userId: string;
  provider: ProfessionalNetworkSource;
  /** Defaults to 'manual_refresh' — a user-initiated sync from the UI. */
  syncType?: SyncType;
};

export type RunProviderSyncResult =
  | { ok: true; pending?: false; job: ProfessionalNetworkSyncJob }
  | { ok: false; pending: true; reason: string; job: ProfessionalNetworkSyncJob | null }
  | { ok: false; pending?: false; error: string; job: ProfessionalNetworkSyncJob | null };

/**
 * Run a backend connector sync for one provider, recording the run in
 * professional_network_sync_jobs under the caller's RLS session.
 *
 *   1. insert a job row (status 'running')
 *   2. resolve the connector from PROFESSIONAL_NETWORK_CONNECTORS
 *   3. if the connector is unavailable → mark the job 'paused' with the reason
 *      and return { ok:false, pending:true }
 *   4. if available → call connector.sync(orgId), record counts, and mark
 *      'completed' or 'failed'
 */
export async function runProviderSync(
  supabase: Client,
  args: RunProviderSyncArgs,
): Promise<RunProviderSyncResult> {
  const { orgId, userId, provider } = args;
  const syncType: SyncType = args.syncType ?? "manual_refresh";

  const connector = PROFESSIONAL_NETWORK_CONNECTORS.find((c) => c.provider === provider);
  if (!connector) {
    return { ok: false, error: `Unknown backend connector: ${provider}`, job: null };
  }

  // 1. Record the attempt up front (status 'running'), so a crash mid-sync
  // still leaves an auditable trail rather than a silent gap.
  const startedAt = new Date().toISOString();
  const { data: job, error: insertError } = await supabase
    .from("professional_network_sync_jobs")
    .insert({
      organization_id: orgId,
      created_by: userId,
      provider,
      sync_type: syncType,
      status: "running",
      started_at: startedAt,
    })
    .select("*")
    .single();

  if (insertError || !job) {
    return { ok: false, error: insertError?.message ?? "Could not start sync job", job: null };
  }

  // 3. Honest availability gate: no credentials → pause, don't pretend.
  const availability = connector.availability();
  if (!availability.available) {
    const paused = await finalizeJob(supabase, job.id, {
      status: "paused",
      error_message: availability.reason,
    });
    return { ok: false, pending: true, reason: availability.reason, job: paused ?? job };
  }

  // 4. Live pull. connector.sync ultimately routes records through
  // addProfessionalContact (pipeline.server) so every source lands identically
  // in the Capital Relationship Graph.
  // TODO(oauth): once provider credentials exist, connector.sync will fetch
  // authorized records server-side and feed them through addProfessionalContact,
  // reporting recordsSeen/created/updated/deduped back here.
  try {
    const result = await connector.sync(orgId);
    const finished = await finalizeJob(supabase, job.id, {
      status: result.ok ? "completed" : "failed",
      records_seen: result.recordsSeen,
      records_created: result.recordsImported,
      error_message: result.ok ? null : result.error ?? "Sync failed",
    });
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Sync failed", job: finished ?? job };
    }
    return { ok: true, job: finished ?? job };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    const failed = await finalizeJob(supabase, job.id, { status: "failed", error_message: message });
    return { ok: false, error: message, job: failed ?? job };
  }
}

/** Patch a job row to its terminal state and return the updated row. */
async function finalizeJob(
  supabase: Client,
  jobId: string,
  patch: Partial<ProfessionalNetworkSyncJob> & { status: string },
): Promise<ProfessionalNetworkSyncJob | null> {
  const { data } = await supabase
    .from("professional_network_sync_jobs")
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .select("*")
    .single();
  return data ?? null;
}
