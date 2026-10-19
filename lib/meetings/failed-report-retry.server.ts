// lib/meetings/failed-report-retry.server.ts
// Trying again for the reports the model never wrote.
//
// A report row is filed with an empty summary when the model was asked and
// failed — the end-of-meeting route writes one so the transcript survives and
// the meeting still closes. The regenerate button is the way back from it, and
// it needs a host who notices. When the failure is the Anthropic account
// running out of credit, EVERY meeting that ends until it is topped up lands
// in that state, and nothing retried them afterwards: on 2026-10-19 three real
// transcripts (the longest 56 minutes) sat as blank reports with the cause in
// a Vercel log nobody reads.
//
// This is the hourly pass that does it for them: the newest report of an ended
// meeting is blank, not on purpose, and has a transcript behind it, so the
// same path the regenerate button uses is run again. It stops at the first
// billing refusal rather than hammering an account that cannot answer.
//
// Bounded the way the stale-meeting sweep is, and for the same reason: one
// model call can take most of the cron's own envelope, so one a pass, and
// the backlog is worked off an hour at a time. Idempotent — a retry that
// lands writes a newer row with a summary and the meeting stops matching.
//
// No `server-only` import, matching the other sweeps.
import type Anthropic from "@anthropic-ai/sdk";
import type { createServerClient } from "@/lib/supabase/server";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { logId } from "@/lib/log-safe";
import { unsummarisedReason } from "@/lib/meetings/report-generation";
import {
  generateReportFromStoredTranscript,
  type ReportableMeeting,
} from "@/lib/meetings/report-generation.server";

type Client = Awaited<ReturnType<typeof createServerClient>>;

/** Blank reports read per pass. Most share a meeting or were already retried. */
export const RETRY_CANDIDATE_LIMIT = 50;

/** Model calls one pass may make. One, as in the stale-meeting sweep. */
export const MAX_RETRIES_PER_PASS = 1;

/**
 * How far back a blank report is still worth a retry. A report nobody has
 * looked at in a week is not being waited for, and the bound keeps a
 * transcript the model can never summarise from being tried for ever.
 */
export const RETRY_WINDOW_MS = 7 * 24 * 3_600_000;

export interface FailedReportRetryStats {
  /** Meetings whose newest report is blank and not on purpose. */
  candidates: number;
  /** A summary was written. */
  retried: number;
  /** The model was asked again and nothing usable came back. */
  failed: number;
  /** The account refused for billing; the pass stopped there. */
  billingBlocked: boolean;
}

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const MEETING_SELECT = "id, title, host_id, organization_id, deal_id, attendees, status, started_at, ended_at, deleted_at";

/** The Anthropic API's answer when the account has no credit left. */
export function isBillingRefusal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /credit balance is too low/i.test(message);
}

function defaultClient(): Anthropic | null {
  return process.env.ANTHROPIC_API_KEY
    ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
    : null;
}

/**
 * Retry the blank reports of ended meetings. Never throws.
 *
 * With no API key there is nothing to retry with, so the pass reads nothing
 * and reports nothing: a blank report written for that reason is the
 * success path of the report route, and asking again would only repeat it.
 */
export async function runFailedReportRetry(
  supabase: Client,
  opts: { now?: Date; client?: Anthropic | null; model?: string; limit?: number } = {},
): Promise<FailedReportRetryStats> {
  const now = opts.now ?? new Date();
  const stats: FailedReportRetryStats = { candidates: 0, retried: 0, failed: 0, billingBlocked: false };
  const client = "client" in opts ? opts.client : defaultClient();
  if (!client) return stats;
  const model = opts.model ?? MODEL;
  const since = new Date(now.getTime() - RETRY_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("live_meeting_reports")
    .select("id, meeting_id, analysis")
    .eq("summary", "")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? RETRY_CANDIDATE_LIMIT);
  if (error) {
    console.error("[failed-report-retry] could not read blank reports", error.message);
    return stats;
  }

  // Newest blank report per meeting, minus the ones that are blank on purpose.
  const blank = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; meeting_id: string; analysis: Record<string, unknown> | null }>) {
    if (blank.has(row.meeting_id)) continue;
    if (unsummarisedReason(row.analysis)) continue;
    blank.set(row.meeting_id, row.id);
  }

  let calls = 0;
  for (const [meetingId, reportId] of blank) {
    try {
      // Only when that blank row is still the newest: a retry, a regenerate
      // or a correction since then has already answered it.
      const { data: latest } = await supabase
        .from("live_meeting_reports")
        .select("id")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest || latest.id !== reportId) continue;

      const { data: meeting } = await supabase
        .from("live_meetings")
        .select(MEETING_SELECT)
        .eq("id", meetingId)
        .maybeSingle();
      const row = meeting as (ReportableMeeting & { deleted_at: string | null }) | null;
      if (!row || row.status !== "ended" || row.deleted_at) continue;

      stats.candidates += 1;
      if (calls >= MAX_RETRIES_PER_PASS) continue;

      calls += 1;
      const outcome = await generateReportFromStoredTranscript(supabase, {
        meeting: row,
        hostEmail: null,
        client,
        model,
        now,
      });
      if (outcome.kind === "written") {
        stats.retried += 1;
      } else if (outcome.kind !== "unsummarised" && outcome.kind !== "no_transcript") {
        stats.failed += 1;
        console.error("[failed-report-retry] report not written", { meetingId: logId(meetingId), outcome: outcome.kind });
      }
    } catch (err) {
      if (isBillingRefusal(err)) {
        stats.billingBlocked = true;
        console.error("[failed-report-retry] the Anthropic account is out of credit; blank reports wait for a top-up");
        break;
      }
      stats.failed += 1;
      console.error("[failed-report-retry] failed", { meetingId: logId(meetingId) }, err);
    }
  }

  return stats;
}
