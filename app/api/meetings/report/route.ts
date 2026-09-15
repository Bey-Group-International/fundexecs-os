import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { createTeamTask } from "@/lib/team-tasks";
import { persistInstitutionalMeetingRecord } from "@/lib/meetings/service";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { EMPTY_REPORT, clampTranscript, generateMeetingReport } from "@/lib/meetings/report-analysis";
import { chooseTranscript, restoreTranscript, type StoredLine } from "@/lib/meetings/transcript-restore";

export const runtime = "nodejs";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
  : null;

type ReportSupabase = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Close a meeting out when the model could not summarise it.
 *
 * Two things here belong to the meeting, not to the model, so a failed
 * analysis must not skip them:
 *
 *  - the transcript is kept on a report row, which is where the regenerate
 *    route reads `full_transcript` from; and
 *  - the meeting is marked ended. This route is the ONLY place that ever
 *    marks one ended, and `/api/meetings/upcoming` lists anything that is
 *    not — so skipping it strands a finished meeting in "Upcoming" forever.
 *
 * Deliberately not doing the rest of the success path: no institutional
 * record and no auto-created tasks. There is nothing to record and no action
 * items to create, and the retry re-runs both.
 */
async function endWithoutAnalysis(
  supabase: ReportSupabase,
  meetingId: string,
  transcript: string,
): Promise<void> {
  await supabase.from("live_meeting_reports").insert({
    meeting_id: meetingId,
    summary: "",
    key_points: [] as import("@/lib/supabase/database.types").Json,
    action_items: [] as import("@/lib/supabase/database.types").Json,
    full_transcript: transcript,
    analysis: { ...EMPTY_REPORT } as import("@/lib/supabase/database.types").Json,
  });
  await supabase
    .from("live_meetings")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", meetingId);
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      meetingId: string;
      title?: string;
      participants?: string[];
      transcript: string;
      duration?: number;
    };

    if (!body.meetingId || !body.transcript?.trim()) {
      return NextResponse.json({ error: "meetingId and transcript required" }, { status: 400 });
    }

    // Verify caller is the meeting host
    const { data: meeting } = await supabase
      .from("live_meetings")
      .select("id, host_id, organization_id, deal_id, title")
      .eq("id", body.meetingId)
      .single();

    if (!meeting || meeting.host_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The transcript on file, not just the one the browser posted.
    //
    // `live_meeting_transcripts` has been written throughout every call this
    // product has ever hosted and read by nothing, anywhere — a backup that was
    // never once restored. The report was built from the host's browser memory
    // alone, so the entire record of a meeting hung on one tab surviving to the
    // end of it: a crash, a reload, a phone call, a closed laptop, and the
    // meeting was gone while the rows that could have rebuilt it sat here.
    //
    // A failure to read is not a failure to report. The posted transcript is
    // still in hand, and answering 500 because the backup was unreachable would
    // lose a meeting we can perfectly well summarise.
    let stored = "";
    try {
      const { data: rows } = await supabase
        .from("live_meeting_transcripts")
        .select("speaker, text, ts, confidence, overlapped")
        .eq("meeting_id", body.meetingId)
        .order("ts", { ascending: true });
      if (rows?.length) stored = restoreTranscript(rows as unknown as StoredLine[]);
    } catch (err) {
      console.warn("[/api/meetings/report] stored transcript unavailable", err);
    }

    // Cap transcript to stay within model context / cost budget.
    const transcript = clampTranscript(chooseTranscript(body.transcript, stored));

    // The prompt and schema live in lib/meetings/report-analysis so the
    // regenerate path produces the identical shape — the log reads
    // `analysis.decisions`, which exists in no column of its own.
    // A model failure is preserved, then reported — it used to be preserved
    // and then reported as success, which is the bug this shape exists to fix.
    // MeetingRoom navigates to the report page on `res.ok` and only offers its
    // "try again" on a failure, so answering 200 with an empty report sent the
    // host to a blank page with no way back: the log's regenerate action is
    // gated on `hasReport` (`summary.length > 0`), so it was hidden for that
    // row too. Answering 500 puts the room in its retry state, and the retry
    // re-posts the transcript it still holds in memory.
    //
    // A missing API key is NOT a failure and still takes the success path:
    // generateMeetingReport returns the empty report rather than throwing.
    let analysis: Record<string, unknown>;
    try {
      analysis = await generateMeetingReport(client, MODEL, {
        title: body.title ?? "Untitled",
        participants: body.participants ?? [],
        transcript,
        durationSeconds: body.duration ?? null,
      });
    } catch (err) {
      console.error("[/api/meetings/report] analysis failed", err);
      await endWithoutAnalysis(supabase, body.meetingId, transcript);
      throw err;
    }

    // Save to DB
    const { data: report, error } = await supabase
      .from("live_meeting_reports")
      .insert({
        meeting_id: body.meetingId,
        summary: normalizeNoteText(analysis.summary),
        key_points: analysis.key_points as import("@/lib/supabase/database.types").Json,
        action_items: analysis.action_items as import("@/lib/supabase/database.types").Json,
        full_transcript: transcript,
        analysis: analysis as import("@/lib/supabase/database.types").Json,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Mark meeting as ended
    await supabase
      .from("live_meetings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", body.meetingId);

    await persistInstitutionalMeetingRecord(supabase, {
      meeting,
      actorId: user.id,
      participants: body.participants ?? [],
      transcript,
      analysis,
    });

    // Fire-and-forget: create a task for each action item
    const actionItems = normalizeNoteList(analysis.action_items);
    if (actionItems.length > 0 && meeting.organization_id) {
      void Promise.allSettled(
        actionItems.map((item) =>
          createTeamTask(supabase, {
            organizationId: meeting.organization_id!,
            assignedTo: user.id,
            assignedBy: user.id,
            title: item.slice(0, 120),
            description: `Auto-created from meeting: ${meeting.title ?? body.title ?? "Untitled"}`,
            hub: "execute",
            module: "live_meetings",
            priority: "normal",
            contextSnapshot: normalizeNoteText(analysis.summary),
          }),
        ),
      );
    }

    return NextResponse.json({ reportId: report.id, analysis });
  } catch (err) {
    console.error("[/api/meetings/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 },
    );
  }
}
