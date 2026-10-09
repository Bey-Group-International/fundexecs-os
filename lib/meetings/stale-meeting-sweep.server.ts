// lib/meetings/stale-meeting-sweep.server.ts
// Closing the meetings nobody ended, and writing their reports.
//
// A meeting is marked `ended` by exactly one thing: somebody pressing End in
// the room, which posts the transcript to the report route. A host who shut
// the laptop, lost the tab, or walked away from a call that had already
// emptied leaves the row `active` forever — in "Upcoming", with no report,
// and with the whole conversation sitting in live_meeting_transcripts where
// nothing would ever read it. The regenerate route can write that report
// now, but it needs the host to notice and to press a button.
//
// This is the hourly pass that does it for them. For every meeting still
// open three hours after the last sign of life: if the call wrote any
// transcript rows, the report is written through the same path the
// regenerate button uses (service role, no session); if it wrote none, the
// meeting is closed with a report row that says there was nothing to
// summarise. Either way the meeting leaves "Upcoming" and enters the log.
//
// Idempotent by construction — a closed meeting no longer matches the query
// — and bounded two ways: in rows read, and in model calls made, because one
// model call can take most of the cron's own envelope.
//
// No `server-only` import, matching the other sweeps: the `.server` suffix is
// the marker, and the guard would put this beyond the reach of a test.
import type Anthropic from "@anthropic-ai/sdk";
import type { createServerClient } from "@/lib/supabase/server";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { logId } from "@/lib/log-safe";
import { MEETING_KIND } from "@/lib/meetings/one-way";
import { PRESENT_LIMIT } from "@/lib/meetings/recipients.server";
import {
  STALE_MEETING_MS,
  isAbandonedMeeting,
  lastActivityAt,
  type MeetingActivity,
} from "@/lib/meetings/report-generation";
import {
  closeMeeting,
  generateReportFromStoredTranscript,
  writeUnsummarisedReport,
  type ReportableMeeting,
} from "@/lib/meetings/report-generation.server";

type Client = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Open meetings read per sweep. Most will not be abandoned — a candidate is
 * merely "created more than three hours ago and not ended", which is every
 * meeting booked more than three hours in advance — so the read is wider
 * than the work.
 */
export const CANDIDATE_LIMIT = 50;

/**
 * Model calls one sweep may make.
 *
 * One, deliberately. The report model runs on the long-run client — up to
 * 240s of upstream time with its retry — inside a cron whose whole envelope
 * is 300s and which has a dozen other jobs to run. Two in one pass could end
 * the sweep mid-write. A backlog of unended meetings with transcripts is
 * worked off one an hour, which is fine: nobody is waiting on these.
 */
export const MAX_REPORTS_PER_SWEEP = 1;

export interface StaleMeetingSweepStats {
  /** Open meetings old enough to look at. */
  candidates: number;
  /** Closed with a report written from the transcript. */
  reported: number;
  /** Closed with an empty report: nothing transcribed, or nothing usable. */
  closed: number;
  /** Abandoned, with a transcript, and left for the next sweep's model budget. */
  deferred: number;
  /** Something went wrong; the meeting is left as it was for the next pass. */
  failed: number;
}

const SELECT =
  "id, title, host_id, organization_id, deal_id, attendees, status, started_at, ended_at, scheduled_at, created_at";

type Candidate = ReportableMeeting & { scheduled_at: string | null; created_at: string };

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

function defaultClient(): Anthropic | null {
  return process.env.ANTHROPIC_API_KEY
    ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
    : null;
}

/** The signs of life a meeting left behind, from its own tables. */
async function activityOf(
  supabase: Client,
  meeting: Candidate,
): Promise<MeetingActivity & { firstJoinedAt: string | null; hasTranscript: boolean }> {
  const [participants, spoken] = await Promise.all([
    supabase
      .from("live_meeting_participants")
      .select("joined_at, left_at")
      .eq("meeting_id", meeting.id)
      .limit(PRESENT_LIMIT + 1),
    supabase
      .from("live_meeting_transcripts")
      .select("ts")
      .eq("meeting_id", meeting.id)
      .order("ts", { ascending: false })
      .limit(1),
  ]);

  let firstJoinedAt: string | null = null;
  let lastJoinedAt: string | null = null;
  let lastLeftAt: string | null = null;
  for (const row of (participants.data ?? []) as Array<{ joined_at: string | null; left_at: string | null }>) {
    if (row.joined_at && (!firstJoinedAt || row.joined_at < firstJoinedAt)) firstJoinedAt = row.joined_at;
    if (row.joined_at && (!lastJoinedAt || row.joined_at > lastJoinedAt)) lastJoinedAt = row.joined_at;
    if (row.left_at && (!lastLeftAt || row.left_at > lastLeftAt)) lastLeftAt = row.left_at;
  }
  const lastSpokenAt = ((spoken.data ?? []) as Array<{ ts: string }>)[0]?.ts ?? null;

  return {
    status: meeting.status,
    scheduled_at: meeting.scheduled_at,
    started_at: meeting.started_at,
    created_at: meeting.created_at,
    lastJoinedAt,
    lastLeftAt,
    lastSpokenAt,
    firstJoinedAt,
    hasTranscript: lastSpokenAt !== null,
  };
}

/**
 * Close every meeting that has been abandoned, writing its report where
 * there is one to write. Never throws.
 */
export async function runStaleMeetingSweep(
  supabase: Client,
  opts: { now?: Date; client?: Anthropic | null; model?: string; limit?: number } = {},
): Promise<StaleMeetingSweepStats> {
  const now = opts.now ?? new Date();
  const stats: StaleMeetingSweepStats = { candidates: 0, reported: 0, closed: 0, deferred: 0, failed: 0 };
  // Resolved once, lazily: a sweep with nothing to summarise never builds one.
  let client: Anthropic | null | undefined = "client" in opts ? opts.client : undefined;
  const model = opts.model ?? MODEL;
  let reports = 0;

  // Only meetings that could possibly be stale. The age cut is on created_at
  // because that is the latest the row could have been touched by creation —
  // the real decision reads the activity below, and a meeting created an hour
  // ago cannot have been quiet for three.
  const cutoff = new Date(now.getTime() - STALE_MEETING_MS).toISOString();
  const { data, error } = await supabase
    .from("live_meetings")
    .select(SELECT)
    .in("status", ["waiting", "active"])
    .is("deleted_at", null)
    .eq("is_draft", false)
    .eq("kind", MEETING_KIND)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? CANDIDATE_LIMIT);

  if (error) {
    console.error("[stale-meeting-sweep] could not read open meetings", error.message);
    return stats;
  }

  for (const row of (data ?? []) as unknown as Candidate[]) {
    stats.candidates += 1;
    try {
      const activity = await activityOf(supabase, row);
      if (!isAbandonedMeeting(activity, now.getTime())) continue;

      // The end is the last thing that happened, not the moment the sweep
      // noticed — the report page and the log both show a length from it.
      const endedAt = new Date(lastActivityAt(activity) ?? now.getTime()).toISOString();

      if (!activity.hasTranscript) {
        await writeUnsummarisedReport(supabase, { meetingId: row.id, transcript: "", reason: "silent" });
        await closeMeeting(supabase, { meeting: row, endedAt, firstJoinedAt: activity.firstJoinedAt });
        stats.closed += 1;
        continue;
      }

      if (reports >= MAX_REPORTS_PER_SWEEP) {
        stats.deferred += 1;
        continue;
      }
      if (client === undefined) client = defaultClient();

      const outcome = await generateReportFromStoredTranscript(supabase, {
        meeting: row,
        hostEmail: null,
        client,
        model,
        endedAt,
        now,
      });

      switch (outcome.kind) {
        case "written":
          reports += 1;
          stats.reported += 1;
          break;
        case "unsummarised":
          // Filed without a model call; the budget is untouched.
          stats.closed += 1;
          break;
        case "no_transcript":
          // The rows were there a moment ago. Treated as silence rather than
          // left open forever.
          await writeUnsummarisedReport(supabase, { meetingId: row.id, transcript: "", reason: "silent" });
          await closeMeeting(supabase, { meeting: row, endedAt, firstJoinedAt: activity.firstJoinedAt });
          stats.closed += 1;
          break;
        default:
          // "empty", "save_failed" or "refused": the model was asked (or
          // would have been) and nothing usable came back. Left open for the
          // next pass; the budget is spent regardless, so one bad meeting
          // cannot burn through it.
          reports += 1;
          stats.failed += 1;
          console.error("[stale-meeting-sweep] report not written", { meetingId: logId(row.id), outcome: outcome.kind });
      }
    } catch (err) {
      stats.failed += 1;
      console.error("[stale-meeting-sweep] failed", { meetingId: logId(row.id) }, err);
    }
  }

  return stats;
}
