import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { createTeamTask } from "@/lib/team-tasks";
import { persistInstitutionalMeetingRecord } from "@/lib/meetings/service";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { EMPTY_REPORT, clampTranscript, generateMeetingReport } from "@/lib/meetings/report-analysis";

export const runtime = "nodejs";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
  : null;

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

    // Cap transcript to stay within model context / cost budget.
    const transcript = clampTranscript(body.transcript);

    // The prompt and schema live in lib/meetings/report-analysis so the
    // regenerate path produces the identical shape — the log reads
    // `analysis.decisions`, which exists in no column of its own.
    let analysis: Record<string, unknown> = { ...EMPTY_REPORT };
    try {
      analysis = await generateMeetingReport(client, MODEL, {
        title: body.title ?? "Untitled",
        participants: body.participants ?? [],
        transcript,
        durationSeconds: body.duration ?? null,
      });
    } catch (err) {
      // A model failure must not cost the transcript: the report is saved
      // empty and the meeting still ends, which is what happened before this
      // was extracted.
      console.error("[/api/meetings/report] analysis failed", err);
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
