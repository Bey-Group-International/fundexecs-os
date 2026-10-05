import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { persistInstitutionalMeetingRecord } from "@/lib/meetings/service";
import { createActionItemTasks } from "@/lib/meetings/action-items.server";
import { parseActionItem } from "@/lib/meetings/action-items";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { EMPTY_REPORT, clampTranscript, generateMeetingReport } from "@/lib/meetings/report-analysis";
import { mergeTranscripts, restoreTranscript, type StoredLine } from "@/lib/meetings/transcript-restore";
import { meanRowConfidence, qualityPreamble, transcriptForModel, transcriptQuality } from "@/lib/meetings/transcript-quality";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { inferStartedAt } from "@/lib/meetings/meeting-span";
import { ONE_WAY_KIND } from "@/lib/meetings/one-way";
import { loadReportRoles } from "@/lib/meetings/report-roles.server";
import {
  recordMeetingOnTimelines,
  type MeetingForCrm,
} from "@/lib/meetings/crm-activity.server";

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
  crm?: { meeting: MeetingForCrm; actorId: string | null },
): Promise<void> {
  await supabase.from("live_meeting_reports").insert({
    meeting_id: meetingId,
    summary: "",
    key_points: [] as import("@/lib/supabase/database.types").Json,
    action_items: [] as import("@/lib/supabase/database.types").Json,
    full_transcript: transcript,
    analysis: { ...EMPTY_REPORT } as import("@/lib/supabase/database.types").Json,
  });
  const endedAt = new Date().toISOString();
  await supabase
    .from("live_meetings")
    .update({ status: "ended", ended_at: endedAt })
    .eq("id", meetingId);

  // The CRM record of a meeting that happened, even though nothing was
  // summarised. Omitting it would make the contact's timeline quietly
  // incomplete, and an incomplete timeline is what makes relationship scoring
  // wrong. The entry carries no report and is REPLACED, not duplicated, if a
  // regenerate later produces one — both write on the same key.
  if (crm) {
    await recordMeetingOnTimelines(supabase as never, {
      meeting: crm.meeting,
      actorId: crm.actorId,
      endedAt,
      durationMinutes: null,
      report: null,
    });
  }
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

    if (!body.meetingId) {
      return NextResponse.json({ error: "meetingId required" }, { status: 400 });
    }

    // Verify caller is the meeting host
    const { data: meeting } = await supabase
      .from("live_meetings")
      // room_code and attendees are for the CRM timeline entry (the report link
      // and the invite list); they cost nothing on a select that already runs.
      .select("id, host_id, organization_id, deal_id, title, started_at, scheduled_at, kind, room_code, attendees")
      .eq("id", body.meetingId)
      .single();

    if (!meeting || meeting.host_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Everything the CRM write needs about this meeting, gathered once because
    // three paths below reach it: the success path, and the two that close a
    // meeting without an analysis.
    const crm = {
      actorId: user.id,
      meeting: {
        id: body.meetingId,
        organizationId: (meeting as { organization_id?: string | null }).organization_id ?? null,
        roomCode: (meeting as { room_code?: string | null }).room_code ?? null,
        title: body.title ?? meeting.title ?? null,
        startedAt: meeting.started_at ?? null,
        scheduledAt: meeting.scheduled_at ?? null,
        attendees: (meeting as { attendees?: unknown }).attendees ?? null,
        hostEmail: user.email ?? null,
      } satisfies MeetingForCrm,
    };

    if (!body.transcript?.trim()) {
      // A ONE-WAY CALL with nothing transcribed is a real and ordinary outcome:
      // this browser has no speech recognition, or nobody said anything it
      // recognised. The audio still exists and the session still has to be
      // closed out — this route is the only thing that ever marks a meeting
      // ended, so refusing here left the call sitting open forever and sent the
      // person to a report page that generated nothing, indefinitely.
      //
      // For a MEETING the refusal stands. A meeting with no transcript at all
      // is a meeting that did not happen or a bug, and either way writing an
      // empty report over it would bury the evidence.
      if ((meeting as { kind?: string | null }).kind === ONE_WAY_KIND) {
        await endWithoutAnalysis(supabase, body.meetingId, "", crm);
        return NextResponse.json({ ok: true, summarised: false });
      }
      return NextResponse.json({ error: "meetingId and transcript required" }, { status: 400 });
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
    //
    // Paged, because this read is capped. `max_rows = 1000` in
    // supabase/config.toml means an unbounded select returns the first
    // thousand rows in silence, and ordering by `ts` makes those the earliest
    // thousand — so a long meeting was summarised from its opening and not its
    // end. `id` is the tiebreak: rows sharing a timestamp need a total order,
    // or a page boundary landing inside a tie drops a row or repeats one.
    // Who the follow-up is from and who it is to, started now so it overlaps
    // the transcript read below rather than queueing behind it.
    const rolesLookup = loadReportRoles(supabase, {
      meetingId: body.meetingId,
      hostId: user.id,
      hostEmail: user.email ?? null,
      invited: (meeting as { attendees?: unknown }).attendees ?? null,
    });

    // When the room opened. `started_at` was never written by the room (its
    // write was a query builder that was never awaited, so never sent), so the
    // earliest attendance row stands in: without it the report page shows no
    // length for a meeting with no recording, and the regenerate route hands
    // the model the scheduled length as if it had been measured. Read in
    // parallel with the transcript; a failure here costs the column, not the
    // report.
    const firstJoinRead = supabase
      .from("live_meeting_participants")
      .select("joined_at")
      .eq("meeting_id", body.meetingId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .then(
        (res) => (res.data as Array<{ joined_at: string | null }> | null)?.[0]?.joined_at ?? null,
        () => null,
      );

    let stored = "";
    let storedRows: StoredLine[] = [];
    try {
      const rows = await readAllTranscriptRows((from, to) =>
        supabase
          .from("live_meeting_transcripts")
          .select("speaker, text, ts, confidence, overlapped")
          .eq("meeting_id", body.meetingId)
          .order("ts", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      storedRows = rows as unknown as StoredLine[];
      if (rows.length) stored = restoreTranscript(storedRows);
    } catch (err) {
      console.warn("[/api/meetings/report] stored transcript unavailable", err);
    }

    // Cap transcript to stay within model context / cost budget.
    const transcript = clampTranscript(mergeTranscripts(body.transcript, stored));

    // What the model reads, which is not the same thing as what is stored.
    //
    // The record keeps every line the room heard, including the ones the speech
    // engine scored as noise and the ones that were a smart speaker in the room
    // being woken. That is right for a record and wrong for a summariser: handed
    // an hour of recognised noise, a model either apologises — which is the best
    // case, and is luck — or confidently summarises decisions nobody made.
    //
    // So the model's copy has those lines withheld, and is told how many and why,
    // from the engine's own scores on the stored rows. `full_transcript` below is
    // the untouched record.
    const quality = transcriptQuality(transcript, { meanConfidence: meanRowConfidence(storedRows) });
    const note = qualityPreamble(quality);
    const readable = transcriptForModel(transcript);
    const modelTranscript = note ? `${note}\n${readable}` : readable;
    if (quality.verdict === "unusable" || quality.verdict === "silent") {
      console.warn(
        `[/api/meetings/report] meeting ${body.meetingId} transcript is ${quality.verdict}:`
        + ` ${quality.usable} of ${quality.heard} lines usable`
        + ` (${quality.withheldNoise} noise, ${quality.withheldAssistant} assistant)`,
      );
    }

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
    const [roles, firstJoinedAt] = await Promise.all([rolesLookup, firstJoinRead]);
    // The end is now; the start is whatever the evidence says. Decided once,
    // here, so the meeting row, the CRM timeline and the institutional record
    // all carry the same span.
    const endedAt = new Date().toISOString();
    const startedAt = inferStartedAt({
      startedAt: meeting.started_at,
      firstJoinedAt,
      endedAt,
      durationSeconds: body.duration ?? null,
    });
    crm.meeting.startedAt = startedAt;

    let analysis: Record<string, unknown>;
    try {
      analysis = await generateMeetingReport(client, MODEL, {
        title: body.title ?? "Untitled",
        participants: body.participants ?? [],
        transcript: modelTranscript,
        durationSeconds: body.duration ?? null,
        host: roles.host,
        recipients: roles.recipients,
      });
    } catch (err) {
      console.error("[/api/meetings/report] analysis failed", err);
      await endWithoutAnalysis(supabase, body.meetingId, transcript, crm);
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

    // Three writes that need only the report to exist, and not each other: the
    // meeting closed out, the institutional record, and a task per action
    // item. They ran one after another — five or six round trips the host sat
    // through on the "Generating report…" screen after the model had already
    // answered. Now they overlap and the wait is the slowest of them.
    const actionItems = normalizeNoteList(analysis.action_items);
    const [, , tasks] = await Promise.all([
      supabase
        .from("live_meetings")
        // started_at only when the room never recorded one, and only when
        // there is evidence to record: a recorded start is never overwritten.
        .update({
          status: "ended",
          ended_at: endedAt,
          ...(!meeting.started_at && startedAt ? { started_at: startedAt } : {}),
        })
        .eq("id", body.meetingId),

      persistInstitutionalMeetingRecord(supabase, {
        meeting,
        actorId: user.id,
        participants: body.participants ?? [],
        transcript,
        analysis,
        // When the meeting happened, not when the report ran. Usually moments
        // apart; an hour or more apart whenever this is reached by the room's
        // retry, and a different day whenever a host ends a meeting the next
        // morning.
        occurredAt: startedAt ?? meeting.scheduled_at ?? null,
      }),

      // A task for each action item, on the list of whoever the item names.
      //
      // Awaited, not fired off. This used to be `void Promise.allSettled(...)` on
      // the line before the response: on a serverless runtime the invocation can
      // be frozen the moment the response is sent, so any insert that had not
      // landed simply never did — silently, because nothing was waiting to hear.
      // The inserts run in parallel and cost one round trip.
      raiseActionItemTasks(supabase, {
        meeting,
        meetingId: body.meetingId,
        hostId: user.id,
        title: body.title,
        summary: normalizeNoteText(analysis.summary),
        items: actionItems,
      }),

      // The meeting on the CRM record of everyone in it who is a contact.
      //
      // A fourth sibling rather than a fifth round trip: it needs only the
      // report's content, which is in hand, and none of the other three. It
      // never throws — a timeline entry that cannot be written must not cost the
      // host the report they are waiting on — so its result is not read here.
      recordMeetingOnTimelines(supabase as never, {
        meeting: crm.meeting,
        actorId: crm.actorId,
        endedAt,
        durationMinutes: durationMinutes(body.duration ?? null),
        report: {
          summary: normalizeNoteText(analysis.summary),
          decisions: normalizeNoteList(analysis.decisions),
        },
      }),
    ]);

    return NextResponse.json({ reportId: report.id, analysis, tasks });
  } catch (err) {
    console.error("[/api/meetings/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 },
    );
  }
}

/** The posted duration is seconds; the timeline entry records whole minutes. */
function durationMinutes(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

type ReportMeeting = {
  organization_id: string | null;
  deal_id: string | null;
  title: string | null;
};

async function raiseActionItemTasks(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  input: {
    meeting: ReportMeeting;
    meetingId: string;
    hostId: string;
    title?: string;
    summary: string;
    items: string[];
  },
) {
  const none = { created: 0, routed: 0, unrouted: [] as string[], skipped: 0 };
  const orgId = input.meeting.organization_id;
  if (input.items.length === 0 || !orgId) return none;
  // Loaded only when an item actually names somebody — most of the cost of
  // this route is the model call, and there is no reason to add two table
  // reads to a report whose items are all unowned.
  const named = input.items.some((item) => parseActionItem(item).owner);
  return createActionItemTasks(supabase, {
    orgId,
    // Stamped on each task, and how a retry after a lost response is
    // spotted: the same commitment must not reach a colleague twice.
    meetingId: input.meetingId,
    hostId: input.hostId,
    meetingTitle: input.meeting.title ?? input.title ?? "Untitled",
    dealId: input.meeting.deal_id ?? null,
    summary: input.summary,
    items: input.items,
    directory: named ? await loadOrgDirectory(supabase, orgId) : [],
  });
}
